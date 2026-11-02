/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./app/**/*.{js,ts,jsx,tsx}", "./components/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Paleta tomada del logo de ARGREEN.
        brand: {
          green: "#56bd8b",
          "green-dark": "#3f9c70",
          "green-light": "#eaf7f1",
          navy: "#2d4c71",
          "navy-dark": "#203756",
        },
      },
    },
  },
  plugins: [],
};
