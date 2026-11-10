#!/usr/bin/env bash
# Builds Ember.app. Regenerate the icon with `swift scripts/make-icon.swift Sources/EmberDesktop/Resources/ember-logo.png Resources`.
# Builds Ember.app from the Swift package: a release build of the executable, wrapped in an app bundle
# with an Info.plist, so macOS gives it a bundle id (needed for notifications) and a Dock icon.
set -euo pipefail
cd "$(dirname "$0")/.."

VERSION="${VERSION:-0.1.0}"
APP="build/Ember.app"

swift build -c release --arch arm64 --arch x86_64
BIN="$(swift build -c release --arch arm64 --arch x86_64 --show-bin-path)/EmberDesktop"

rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
cp "$BIN" "$APP/Contents/MacOS/Ember"
cp Resources/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
cp Sources/EmberDesktop/Resources/ember-logo.png "$APP/Contents/Resources/"

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>Ember</string>
  <key>CFBundleDisplayName</key><string>Ember</string>
  <key>CFBundleIdentifier</key><string>${BUNDLE_ID:-dev.byldr.ember.desktop}</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>NSHumanReadableCopyright</key><string>Copyright © 37signals, LLC and NYLLON LLC</string>
  <key>CFBundleExecutable</key><string>Ember</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${VERSION}</string>
  <key>CFBundleVersion</key><string>${VERSION}</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>LSApplicationCategoryType</key><string>public.app-category.social-networking</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>NSPrincipalClass</key><string>NSApplication</string>
</dict>
</plist>
PLIST

# Ad-hoc signature so Gatekeeper lets a locally built copy run. Distributing it to others needs a
# Developer ID signature and notarization instead.
codesign --force --sign - "$APP"
echo "Built $APP"
