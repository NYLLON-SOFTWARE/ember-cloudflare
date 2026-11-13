import AppKit
import SwiftUI

@main
struct EmberApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var delegate
    @State private var state = AppState()

    var body: some Scene {
        WindowGroup("Ember") {
            RootView()
                .environment(state)
                .tint(Brand.accent)
                .frame(minWidth: 760, minHeight: 480)
                .task { await state.start() }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
                    state.setAppActive(true)
                    state.selectionChanged()
                }
                .onReceive(NotificationCenter.default.publisher(for: NSApplication.didResignActiveNotification)) { _ in
                    state.setAppActive(false)
                }
                .onChange(of: state.unreadCount) { _, count in Notifier.shared.setBadge(count) }
                .onAppear {
                    Notifier.shared.openRoom = { id in state.selectedRoomId = id }
                }
        }
        .commands {
            CommandGroup(replacing: .appInfo) {
                Button("About Ember") { showAbout() }
            }
            CommandGroup(after: .appInfo) {
                Button("Sign Out") { Task { await state.signOut() } }
                    .disabled(state.phase != .signedIn)
            }
        }
    }
}

@MainActor
private func showAbout() {
    var options: [NSApplication.AboutPanelOptionKey: Any] = [
        .applicationName: "Ember",
        .credits: NSAttributedString(
            string: "A native Mac client for Ember, the open-source chat that runs on Cloudflare.",
            attributes: [.font: NSFont.systemFont(ofSize: 11), .foregroundColor: NSColor.secondaryLabelColor]),
    ]
    if let logo = Brand.logo { options[.applicationIcon] = logo }
    NSApplication.shared.orderFrontStandardAboutPanel(options: options)
}

final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationDidFinishLaunching(_ notification: Notification) {
        // Under `swift run` there's no bundle, so the process starts as a background tool; make it a
        // regular app with a Dock icon and a menu bar.
        NSApplication.shared.setActivationPolicy(.regular)
        // A bundled app gets its Dock icon from AppIcon.icns; under `swift run`, borrow the logo.
        if Bundle.main.bundleIdentifier == nil, let logo = Brand.logo {
            NSApplication.shared.applicationIconImage = logo
        }
        NSApplication.shared.activate()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { false }
}

struct RootView: View {
    @Environment(AppState.self) private var state

    var body: some View {
        switch state.phase {
        case .starting:
            ProgressView().controlSize(.large)
        case .signedOut:
            SignInView()
        case .signedIn:
            WorkspaceView()
        }
    }
}
