import preset from './tailwind.preset.js';

/** @type {import('tailwindcss').Config} */
export default {
  presets: [preset],
  // Scan @oscarr/shared too — badge classes (COLOR_TOKEN_CLASSES) are defined there.
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}', '../shared/src/**/*.{js,ts,jsx,tsx}'],
  plugins: [],
};
