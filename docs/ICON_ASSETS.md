# Application icon assets

The Windows icon is generated from `assets/branding/psa-game-card-source.png`, the original 1024×1024 transparent artwork.

## Why the icon stays sharp

Windows does not use one bitmap at every UI scale. It looks for an exact-size frame first, then scales down the next larger frame when an exact match is unavailable.

`extendedart.ico` therefore contains native 16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, and 256 pixel frames. This covers the Windows 11 taskbar targets directly instead of relying on resampling:

| Display scale | Taskbar frame |
| --- | ---: |
| 100% | 24×24 |
| 125% | 30×30 |
| 150% | 36×36 |
| 200% | 48×48 |
| 250% | 60×60 |
| 300% | 72×72 |
| 400% | 96×96 |

The build script also removes excessive transparent margins before rendering. The visible artwork occupies roughly 90% of the square width, making the mark as large as practical without clipping its outline. Each small frame receives restrained target-size contrast and sharpening while retaining its original alpha channel.

Do not replace the ICO with a renamed PNG. A single large bitmap forces Windows to resample it for Explorer, the taskbar, Start, installer UI, title bars, and high-DPI views.

The full PSA Game Card artwork contains several cards, metallic highlights, and small lettering. Those details cannot remain fully readable at 24 physical pixels; clarity at that size comes primarily from the large red/white/blue silhouette. The review preview displays both native-size taskbar samples and nearest-neighbor pixel inspection so the preview itself does not introduce smoothing.

## Regenerate

From the repository root:

```powershell
python tools/build_icon_assets.py
python -m unittest tests.test_icon_assets
```

The script requires Pillow, already listed by this project.

Generated files:

- `assets/branding/extendedart-icon.png` — tightly framed 1024×1024 transparent PNG for review and future platform exports.
- `assets/branding/extendedart.ico` — multi-resolution Windows icon used by PyInstaller and Inno Setup.

## Build integration

`ExtendedArtOffline.spec` passes the ICO to PyInstaller so the icon is embedded into `ExtendedArtOffline.exe`.

`installer/ExtendedArt.iss` uses the same ICO for the setup executable. Start Menu and desktop shortcuts explicitly use the installed application executable, keeping the icon consistent after installation.

After installing a new build, Windows may temporarily show a cached older icon. Reinstalling to a clean folder or restarting Explorer refreshes the shell icon cache; this is not an image-quality problem in the asset.
