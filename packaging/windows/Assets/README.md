# Novora Icon Pack

Novora icon assets for browser tabs, installed PWAs, mobile home screens, and project branding.

## Recommended V2 integration

Copy these files into the project's `public/` directory:

- `favicon.svg`
- `favicon.ico`
- `apple-touch-icon.png`
- `icon-192.png`
- `icon-512-rounded.png`
- `icon-192-maskable.png`
- `icon-512.png`
- `manifest.webmanifest`

Add or update these tags in `index.html`:

```html
<link rel="icon" type="image/svg+xml" href="/favicon.svg" />
<link rel="alternate icon" href="/favicon.ico" />
<link rel="apple-touch-icon" href="/apple-touch-icon.png" />
<link rel="manifest" href="/manifest.webmanifest" />
<meta name="theme-color" content="#111827" />
```

`icon-512.png` and `icon-192-maskable.png` contain extra safe-area padding for Android adaptive masks. Use `icon-512-rounded.png` for documentation, repository artwork, and places that do not apply their own mask.

## Colors

- Ink: `#111827`
- Signal cyan: `#42D3C8`
- Warm white: `#F7F4EC`
- Nova yellow: `#FFC857`

