import AppKit
import UserNotifications

/// Local notifications for rooms that turn unread while the app is in the background. Ember's own push
/// is Web Push (VAPID), which a native app can't receive, so these only arrive while the app is running.
@MainActor
final class Notifier: NSObject, UNUserNotificationCenterDelegate {
    static let shared = Notifier()

    /// Set by the app so clicking a notification opens its room.
    var openRoom: ((String) -> Void)?

    /// UNUserNotificationCenter needs a real app bundle; `swift run` has none, so notifications are off there.
    private var available: Bool { Bundle.main.bundleIdentifier != nil }

    func requestPermission() {
        guard available else { return }
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in }
    }

    func post(title: String, body: String, roomId: String) {
        guard available else { return }
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.userInfo = ["roomId": roomId]
        // One notification per room: a newer one replaces the last rather than piling up.
        let request = UNNotificationRequest(identifier: "room-\(roomId)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(request)
    }

    func setBadge(_ count: Int) {
        NSApplication.shared.dockTile.badgeLabel = count > 0 ? String(count) : nil
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let roomId = response.notification.request.content.userInfo["roomId"] as? String
        await MainActor.run {
            NSApplication.shared.activate()
            if let roomId { self.openRoom?(roomId) }
        }
    }
}
