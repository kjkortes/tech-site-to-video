import type { Page } from 'playwright';
import type { DocumentPage, Inventory, PageSection, WalkLocation } from '../lib/types';

export const mapRevision = 3;
export async function mapDocument(page: Page, sourceId: string, pageId: string, order: number): Promise<DocumentPage> {
  const inspect = (input: { sourceId: string; pageId: string; order: number }) => {
    const root = document.querySelector('article.markdown-body') || document.querySelector('main,article,[role="main"]') || document.body;
    function selector(el: Element): string {
      if (el.id) return `#${CSS.escape(el.id)}`;
      const parts: string[] = []; let node: Element | null = el;
      while (node && node !== document.body) {
        const siblings: Element[] = node.parentElement ? [...node.parentElement.children].filter(s=>s.tagName===node!.tagName) : [];
        parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${siblings.indexOf(node)+1})`); node=node.parentElement;
      }
      return `body > ${parts.join(' > ')}`;
    }
    const headings = [...root.querySelectorAll('h1,h2,h3,h4')].filter(el=>getComputedStyle(el).display!=='none' && el.getBoundingClientRect().height>0).slice(0,40);
    const first = headings[0]?.tagName === 'H1' ? headings.shift() : undefined;
    const anchors: Element[] = [root,...headings];
    // A gallery cell/figure may put its screenshot BEFORE its heading. Keep the
    // whole feature block together rather than assigning the image to its neighbour.
    const boundaries=anchors.map((el,index)=>{
      if(index===0)return root;
      const block=el.closest('td,figure,section');
      return block && block.querySelectorAll('h1,h2,h3,h4').length===1 && block.querySelector('img,video,iframe')?block:el;
    });
    const sections = anchors.map((el,index) => {
      const id = `${input.pageId}-section-${index}`; el.setAttribute('data-frameforge-section',id);boundaries[index].setAttribute('data-frameforge-section',id);
      const range = document.createRange();
      if (index===0) range.setStart(root,0); else range.setStartBefore(boundaries[index]);
      if (boundaries[index+1]) range.setEndBefore(boundaries[index+1]); else range.setEnd(root,root.childNodes.length);
      const fragment = range.cloneContents(); fragment.querySelectorAll('script,style,nav').forEach(n=>n.remove());
      fragment.querySelectorAll('p,li,pre,h1,h2,h3,h4,td').forEach(el=>{el.prepend(document.createTextNode(' '));el.append(document.createTextNode(' '));});
      const text = (fragment.textContent||'').replace(/\s+/g,' ').trim().slice(0,10000);
      const level = index===0 ? 1 : Number(el.tagName.slice(1));
      let parentId: string|undefined;
      for(let i=index-1;i>=0;i--) if ((i===0?1:Number(anchors[i].tagName.slice(1)))<level) { parentId=`${input.pageId}-section-${i}`;break; }
      const target=boundaries[index];
      return { id,pageId:input.pageId,sourceId:input.sourceId,heading:(index===0?first?.textContent||'Introduction':el.textContent||'Section').replace(/\s+/g,' ').trim(),order:index,parentId,selector:selector(target),scrollY:Math.max(0,target.getBoundingClientRect().top+scrollY-80),endY:target!==el && index>0?target.getBoundingClientRect().bottom+scrollY:boundaries[index+1]?boundaries[index+1].getBoundingClientRect().top+scrollY:root.getBoundingClientRect().bottom+scrollY,text,assetIds:[] as string[] };
    });
    for(const section of sections) {
      const blocks=[...root.querySelectorAll('p,pre,li')].filter(el=>{
        let owner=root.getAttribute('data-frameforge-section');
        for(const h of headings)if(h.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)owner=h.getAttribute('data-frameforge-section');
        const container=el.closest('[data-frameforge-section]');
        if(container && container!==root)owner=container.getAttribute('data-frameforge-section');
        return owner===section.id && (el.textContent||'').trim().length>25;
      });
      Object.assign(section,{anchors:blocks.slice(0,80).map(el=>({selector:selector(el),scrollY:Math.max(0,el.getBoundingClientRect().top+scrollY-80),text:(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,1500)}))});
    }
    return { id:input.pageId,sourceId:input.sourceId,url:location.href,title:document.title,order:input.order,sections };
  };
  return page.evaluate(`(()=>{const __name=(fn)=>fn;return (${inspect.toString()})(${JSON.stringify({sourceId,pageId,order})});})()`);
}
// Legacy/fixture inventories still have a logical map; real jobs refresh it from DOM.
export function pagesFor(inventory: Inventory): DocumentPage[] {
  if (inventory.pages?.length) return inventory.pages;
  const pages: DocumentPage[]=[];
  for(const scene of inventory.scenes) {
    let page=pages.find(p=>p.url===scene.url && p.sourceId===(scene.sourceId||scene.id));
    if(!page) { page={id:`page-${pages.length+1}`,sourceId:scene.sourceId||scene.id,url:scene.url,title:scene.title,order:pages.length,sections:[]};pages.push(page); }
    const y=scene.actions.find(a=>a.type==='scroll')?.y||0;
    page.sections.push({id:scene.sectionId||scene.id,pageId:page.id,sourceId:page.sourceId,heading:scene.title,order:0,selector:'',scrollY:y,endY:y+2120,text:scene.description,assetIds:[],sceneId:scene.id});
  }
  for(const page of pages) {page.sections.sort((a,b)=>a.scrollY-b.scrollY);page.sections.forEach((s,i)=>s.order=i);}
  return pages;
}
export function locationFor(page: DocumentPage, section: PageSection): WalkLocation {
  return {pageId:page.id,sectionId:section.id,sectionIndex:section.order,url:page.url,scrollY:section.scrollY,selector:section.selector,heading:section.heading};
}

// Browser redirects commonly remove a repository trailing slash or URL hash.
export function entryPageFor(inventory: Inventory, fallback?: DocumentPage) {
  if(!inventory.sourceUrl)return fallback||pagesFor(inventory)[0];
  const key=(url:string)=>{const u=new URL(url);return u.origin+u.pathname.replace(/\/$/,'');};
  return pagesFor(inventory).find(p=>key(p.url)===key(inventory.sourceUrl!));
}
