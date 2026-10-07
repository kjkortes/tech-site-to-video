import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'Frameforge — URL to video', description: 'Turn a public website or GitHub project into a narrated software demo. Review, approve, and download.' };
export default function RootLayout({ children }: { children: React.ReactNode }) { return <html lang="en"><body>{children}</body></html>; }
