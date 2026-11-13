import XCTest
@testable import EmberDesktop

final class ProtocolTests: XCTestCase {
    func testBodyMarkupMatchesThePlainParagraphForm() {
        XCTAssertEqual(bodyMarkup(fromPlainText: "hi"), "<p>hi</p>")
        XCTAssertEqual(bodyMarkup(fromPlainText: "a & <b>\nnext"), "<p>a &amp; &lt;b&gt;<br>next</p>")
    }

    func testServerURLNormalizes() {
        XCTAssertEqual(APIClient.serverURL(from: "chat.example.com/some/path")?.absoluteString, "https://chat.example.com")
        XCTAssertEqual(APIClient.serverURL(from: "http://localhost:8787")?.absoluteString, "http://localhost:8787")
        XCTAssertNil(APIClient.serverURL(from: "  "))
    }

    func testDecodesWelcomeAndUnknownFrames() throws {
        let welcome = """
        {"type":"welcome","you":{"id":"u1","name":"Ann"},"present":[],"seq":7,"hasMore":false,"hasNewer":false,"around":null,
         "messages":[{"id":"m1","clientMessageId":"c1","roomId":"r1","creator":{"id":"u1","name":"Ann"},"body":"<p>hi</p>",
         "plainText":"hi","mentions":[],"createdAt":"2026-11-10T12:00:00.000Z","updatedAt":"2026-11-10T12:00:00.000Z",
         "editedAt":null,"boosts":[]}]}
        """
        guard case let .welcome(_, _, seq, messages, _) = try JSONDecoder().decode(RoomServerFrame.self, from: Data(welcome.utf8)) else {
            return XCTFail("expected a welcome")
        }
        XCTAssertEqual(seq, 7)
        XCTAssertEqual(messages.first?.plainText, "hi")

        guard case .other("huddle.something") = try JSONDecoder().decode(RoomServerFrame.self, from: Data(#"{"type":"huddle.something"}"#.utf8)) else {
            return XCTFail("expected an unknown frame to decode as .other")
        }
    }

    func testDecodesSidebarRoomsOfBothKinds() throws {
        let json = """
        {"rooms":[{"id":"r1","kind":"open","name":"All Talk","icon":null,"unread":true,"involvement":"mentions"},
                  {"id":"r2","kind":"direct","members":[{"id":"u1","name":"Ann"},{"id":"u2","name":"Bo"}],"activeAt":"2026-11-10T12:00:00Z","unread":false,"involvement":"everything"}],
         "favorites":{"rooms":["r2"],"version":3},"sharedOrder":[],"invitation":null,"suggestions":[],"huddles":{}}
        """
        let sidebar = try JSONDecoder().decode(Sidebar.self, from: Data(json.utf8))
        XCTAssertEqual(sidebar.rooms.count, 2)
        XCTAssertEqual(sidebar.rooms[0].title(me: "u1"), "All Talk")
        XCTAssertEqual(sidebar.rooms[1].title(me: "u1"), "Bo")
    }
}
