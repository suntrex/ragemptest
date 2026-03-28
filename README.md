# RageMP Admin Menu

A feature-rich admin menu for [RageMP](https://rage.mp/) GTA V multiplayer servers, inspired by Menyoo.

## Features

| Category        | Functions |
|-----------------|-----------|
| **Player**      | Teleport to waypoint, Heal (HP + Armor), Kill self, Set health/armor, God mode, Invisible |
| **Vehicle**     | Spawn vehicle (by model name), Fix vehicle, Delete vehicle, Flip vehicle |
| **Weapons**     | Give weapon (by name, with auto-complete), Remove all weapons |
| **World**       | Set time (hour + minute), Set weather (12 presets) |
| **Players**     | Live player list, Heal/Kill/Teleport to/Bring/Freeze/Unfreeze/Kick any player |

## Installation

1. Copy `packages/admin/` into your RageMP server's `packages/` directory.
2. Copy `client_packages/admin/` into your RageMP server's `client_packages/` directory.
3. Add `"admin"` to both `"packages"` and `"client_packages"` arrays in `conf.json`.

## Opening the Menu

- Press **F6** at any time (client-side toggle).
- Type `/admin` in chat (requires admin level ≥ 1).

## Admin Levels

| Level | Name       |
|-------|------------|
| 0     | None       |
| 1     | Moderator  |
| 2     | Admin      |
| 3     | Super Admin |

### Granting Admin via Chat Command

```
/setadmin <playerID> <level>
```
Only players with level 3 (Super Admin) can promote others.

### Granting Admin at Startup

Add Social Club names to `HARDCODED_ADMINS` at the top of `packages/admin/index.js`:

```js
const HARDCODED_ADMINS = [
    'YourSocialClubName',
];
```

## File Structure

```
ragemptest/
├── conf.json                          # RageMP server configuration
├── packages/
│   └── admin/
│       └── index.js                   # Server-side admin logic
└── client_packages/
    └── admin/
        ├── index.js                   # Client-side event bridge (F6 key binding, CEF)
        └── html/
            ├── index.html             # Menu layout (tabs, inputs, buttons)
            ├── style.css              # Dark theme styling
            └── script.js             # Menu interaction logic
```
