/** @type {import('next').NextConfig} */
const nextConfig = {
  // Move the option inside the object
  devIndicators: {
    buildActivity: false // This specifically hides the building indicator
    // autoPrerender: false, // Hides the prerender indicator (optional)
  }
  // You can add other Next.js config options here if needed
};

export default nextConfig;
