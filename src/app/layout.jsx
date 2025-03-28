import './globals.css'; // Ensure your global styles are imported

export const metadata = {
  title: 'Free Image Converter',
  description: 'I hate paid converters so I built one for free 😉',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <head>
        {/* Correct favicon path */}
        <link rel="icon" href="/favicon.svg" />
      </head>
      <body>{children}</body>
    </html>
  );
}
