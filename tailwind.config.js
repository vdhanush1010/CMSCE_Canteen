/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./*.{html,js}"],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#00D28A', // Mint Green
          dark: '#00A36C',    // Primary Dark
        },
        secondary: {
          DEFAULT: '#FF6B5B', // Soft Coral/Orange
        },
        warning: {
          DEFAULT: '#FFA801', // Amber for low stock
        },
        background: '#F4FAF7',
        surface: '#FFFFFF',
        text: {
          primary: '#1E293B',   // Dark Charcoal
          secondary: '#64748B', // Slate Gray
        }
      },
      fontFamily: {
        sans: ['Inter', 'Poppins', 'sans-serif'],
      },
      boxShadow: {
        subtle: '0px 4px 12px rgba(0, 0, 0, 0.05)',
        premium: '0px 10px 30px rgba(0, 210, 138, 0.1)',
      },
      borderRadius: {
        card: '16px',
      }
    },
  },
  plugins: [],
}
