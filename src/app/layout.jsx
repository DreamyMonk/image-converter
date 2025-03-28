// src/app/layout.jsx (or .js, .tsx, .ts)

import './globals.css' // Make sure your global styles are imported

// Optional: Add metadata
export const metadata = {
  title: ' Freee Image Converter', // Example title
  description: 'I hate paid converters so i built for free 😉', // Example description
}

export default function RootLayout({ children }) {
  return (
    // The lang attribute is recommended
    <html lang="en">
      {/* You can add a <head> tag here manually if needed, but Next.js often handles it */}
      {/* <head> ... </head> */}

      {/* The body tag is REQUIRED */}
      <body>
        {/* The {children} prop renders the content of your specific pages */}
        {children}
      </body>
    </html>
  )
}