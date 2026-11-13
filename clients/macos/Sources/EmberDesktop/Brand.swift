import AppKit
import SwiftUI

/// Ember's flame logo and colors, shared by the app's views.
enum Brand {
    /// The flame, from the app bundle's Resources, or, under `swift run`, from SwiftPM's resource
    /// bundle beside the executable. (`Bundle.module` would look at the .app's root, which code
    /// signing doesn't allow, so it isn't used.)
    static let logo: NSImage? = {
        if let url = Bundle.main.url(forResource: "ember-logo", withExtension: "png") {
            return NSImage(contentsOf: url)
        }
        let beside = Bundle.main.executableURL?.deletingLastPathComponent()
            .appendingPathComponent("EmberDesktop_EmberDesktop.bundle/ember-logo.png")
        return beside.flatMap { NSImage(contentsOf: $0) }
    }()

    /// The flame's orange, Ember's accent.
    static let accent = Color(red: 1.0, green: 0.42, blue: 0.10)
}

struct EmberLogo: View {
    var size: CGFloat = 64

    var body: some View {
        if let logo = Brand.logo {
            Image(nsImage: logo).resizable().interpolation(.high).scaledToFit().frame(width: size, height: size)
        } else {
            Image(systemName: "flame.fill").font(.system(size: size * 0.7)).foregroundStyle(Brand.accent)
                .frame(width: size, height: size)
        }
    }
}
