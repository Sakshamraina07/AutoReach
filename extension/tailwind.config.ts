import type { Config } from 'tailwindcss';

const v = (name: string) => `rgb(var(--${name}) / <alpha-value>)`;

/** Same tokens as the dashboard so both clients look like one product. */
export default {
  content: ['./popup.html', './sidepanel.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: v('bg'),
        surface: v('surface'),
        raised: v('raised'),
        line: v('line'),
        ink: v('ink'),
        muted: v('muted'),
        faint: v('faint'),
        accent: v('accent'),
        'accent-ink': v('accent-ink'),
        sent: v('sent'),
        opened: v('opened'),
        replied: v('replied'),
        warn: v('warn'),
        danger: v('danger'),
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['11px', '16px'],
        xs: ['12px', '17px'],
        sm: ['13px', '19px'],
        base: ['14px', '21px'],
        lg: ['16px', '23px'],
        xl: ['19px', '26px'],
      },
      borderRadius: { DEFAULT: '6px', md: '8px', lg: '10px' },
    },
  },
  plugins: [],
} satisfies Config;
