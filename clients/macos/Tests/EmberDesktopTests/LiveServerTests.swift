import XCTest
@testable import EmberDesktop

/// Drives the client against a running Ember, such as `pnpm dev` in apps/worker:
///
///     EMBER_TEST_SERVER=http://localhost:8787 EMBER_TEST_EMAIL=... EMBER_TEST_PASSWORD=... swift test
///
/// Skipped unless those are set.
@MainActor
final class LiveServerTests: XCTestCase {
    func testSignInLoadSidebarAndChatInARoom() async throws {
        let env = ProcessInfo.processInfo.environment
        guard let server = env["EMBER_TEST_SERVER"].flatMap(APIClient.serverURL(from:)),
              let email = env["EMBER_TEST_EMAIL"], let password = env["EMBER_TEST_PASSWORD"] else {
            throw XCTSkip("Set EMBER_TEST_SERVER, EMBER_TEST_EMAIL and EMBER_TEST_PASSWORD to run against a live Ember")
        }
        let api = APIClient(server: server)
        let me = try await api.signIn(email: email, password: password)
        let again = try await api.me()
        XCTAssertEqual(again.id, me.id)

        let sidebar = try await api.sidebar()
        let room = try XCTUnwrap(sidebar.rooms.first { !$0.isDirect })

        let store = RoomStore(roomId: room.id, api: api, myId: me.id)
        store.connect()
        try await waitUntil { store.connected }

        let text = "hello from the desktop client \(UUID().uuidString.prefix(8)) & <friends>"
        store.sendMessage(text)
        try await waitUntil { store.messages.contains { $0.plainText == text } }
        XCTAssertTrue(store.pending.isEmpty)

        let sent = try XCTUnwrap(store.messages.first { $0.plainText == text })
        store.toggleBoost("👍", on: sent)
        try await waitUntil { store.messages.first { $0.id == sent.id }?.boosts.count == 1 }

        store.delete(sent)
        try await waitUntil { !store.messages.contains { $0.id == sent.id } }
        store.close()
    }

    private func waitUntil(timeout: TimeInterval = 10, _ condition: () -> Bool) async throws {
        let deadline = Date().addingTimeInterval(timeout)
        while !condition() {
            if Date() > deadline { return XCTFail("Timed out waiting") }
            try await Task.sleep(for: .milliseconds(50))
        }
    }
}
