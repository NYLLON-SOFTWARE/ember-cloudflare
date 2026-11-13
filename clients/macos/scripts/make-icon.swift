// Renders the macOS app icon from Ember's flame logo: the flame on a dark, softly lit rounded square
// in Apple's icon grid (824pt body on a 1024pt canvas, with a drop shadow), then writes AppIcon.icns.
//
//   swift scripts/make-icon.swift <logo.png> <out-dir>
import AppKit

let args = CommandLine.arguments
let logo = NSImage(contentsOfFile: args[1])!
let outDir = URL(fileURLWithPath: args[2])

func render(_ size: Int) -> Data {
    let s = CGFloat(size)
    let rep = NSBitmapImageRep(bitmapDataPlanes: nil, pixelsWide: size, pixelsHigh: size, bitsPerSample: 8,
                               samplesPerPixel: 4, hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB,
                               bytesPerRow: 0, bitsPerPixel: 0)!
    NSGraphicsContext.saveGraphicsState()
    NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
    let ctx = NSGraphicsContext.current!.cgContext

    let unit = s / 1024
    let body = CGRect(x: 100 * unit, y: 100 * unit, width: 824 * unit, height: 824 * unit)
    let path = CGPath(roundedRect: body, cornerWidth: 185 * unit, cornerHeight: 185 * unit, transform: nil)

    // Drop shadow under the body.
    ctx.saveGState()
    ctx.setShadow(offset: CGSize(width: 0, height: -10 * unit), blur: 28 * unit, color: NSColor.black.withAlphaComponent(0.35).cgColor)
    ctx.addPath(path)
    ctx.setFillColor(NSColor.black.cgColor)
    ctx.fillPath()
    ctx.restoreGState()

    // Body: warm near-black, lighter at the top.
    ctx.saveGState()
    ctx.addPath(path)
    ctx.clip()
    let space = CGColorSpaceCreateDeviceRGB()
    let base = CGGradient(colorsSpace: space, colors: [
        CGColor(red: 0.20, green: 0.11, blue: 0.09, alpha: 1),
        CGColor(red: 0.07, green: 0.04, blue: 0.04, alpha: 1),
    ] as CFArray, locations: [0, 1])!
    ctx.drawLinearGradient(base, start: CGPoint(x: 0, y: body.maxY), end: CGPoint(x: 0, y: body.minY), options: [])
    // Glow behind the flame.
    let glow = CGGradient(colorsSpace: space, colors: [
        CGColor(red: 1.0, green: 0.42, blue: 0.10, alpha: 0.38),
        CGColor(red: 1.0, green: 0.30, blue: 0.05, alpha: 0),
    ] as CFArray, locations: [0, 1])!
    let center = CGPoint(x: body.midX, y: body.midY - 40 * unit)
    ctx.drawRadialGradient(glow, startCenter: center, startRadius: 0, endCenter: center, endRadius: 430 * unit, options: [])
    // A hairline highlight along the top edge.
    ctx.addPath(path)
    ctx.setStrokeColor(NSColor.white.withAlphaComponent(0.10).cgColor)
    ctx.setLineWidth(3 * unit)
    ctx.strokePath()
    ctx.restoreGState()

    // The flame.
    let flame = CGRect(x: body.midX - 360 * unit, y: body.midY - 360 * unit, width: 720 * unit, height: 720 * unit)
    NSGraphicsContext.current!.imageInterpolation = .high
    logo.draw(in: flame, from: .zero, operation: .sourceOver, fraction: 1)

    NSGraphicsContext.restoreGraphicsState()
    return rep.representation(using: .png, properties: [:])!
}

let iconset = outDir.appendingPathComponent("AppIcon.iconset")
try? FileManager.default.removeItem(at: iconset)
try! FileManager.default.createDirectory(at: iconset, withIntermediateDirectories: true)
for base in [16, 32, 128, 256, 512] {
    try! render(base).write(to: iconset.appendingPathComponent("icon_\(base)x\(base).png"))
    try! render(base * 2).write(to: iconset.appendingPathComponent("icon_\(base)x\(base)@2x.png"))
}
try! render(1024).write(to: outDir.appendingPathComponent("AppIcon-1024.png"))
let task = Process()
task.executableURL = URL(fileURLWithPath: "/usr/bin/iconutil")
task.arguments = ["-c", "icns", iconset.path, "-o", outDir.appendingPathComponent("AppIcon.icns").path]
try! task.run()
task.waitUntilExit()
try? FileManager.default.removeItem(at: iconset)
print("Wrote AppIcon.icns")
