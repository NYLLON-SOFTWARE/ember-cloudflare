import Foundation

// Swift mirrors of the types in packages/protocol/src/index.ts. Only the fields the desktop client
// uses are declared; JSONDecoder ignores the rest, so the server can add fields without breaking us.

struct User: Codable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct Me: Codable, Hashable {
    let id: String
    let name: String
    let administrator: Bool
}

struct DirectoryUser: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let bio: String?
    let role: String
    let status: String
    let avatarUrl: String
    let agent: Bool?
}

struct Directory: Codable {
    let users: [DirectoryUser]
}

/// A room as the sidebar lists it. The protocol's `Room` is a union of `SharedRoom` (open/closed, with a
/// name and icon) and `DirectRoom` (direct, named by its members); one struct with optionals covers both.
struct Room: Codable, Hashable, Identifiable {
    let id: String
    let kind: String
    var name: String?
    var icon: String?
    var members: [User]?
    var activeAt: String?
    var unread: Bool
    var involvement: String?

    enum CodingKeys: String, CodingKey {
        case id, kind, name, icon, members, activeAt, unread, involvement
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        kind = try c.decode(String.self, forKey: .kind)
        name = try c.decodeIfPresent(String.self, forKey: .name)
        icon = try c.decodeIfPresent(String.self, forKey: .icon)
        members = try c.decodeIfPresent([User].self, forKey: .members)
        activeAt = try c.decodeIfPresent(String.self, forKey: .activeAt)
        // `room.saved` sends a plain Room, which has no unread mark: a room new to someone starts read.
        unread = try c.decodeIfPresent(Bool.self, forKey: .unread) ?? false
        involvement = try c.decodeIfPresent(String.self, forKey: .involvement)
    }

    var isDirect: Bool { kind == "direct" }

    /// A DM is named after everyone in it but whoever's reading.
    func title(me: String?) -> String {
        if let name { return name }
        let others = (members ?? []).filter { $0.id != me }.map(\.name)
        return others.isEmpty ? "Just you" : others.joined(separator: ", ")
    }

    /// Hidden rooms ("invisible") stay openable but the sidebar leaves them out.
    var isHidden: Bool { involvement == "invisible" }
}

struct Favorites: Codable, Hashable {
    let rooms: [String]
    let version: Int
}

struct Sidebar: Codable {
    let rooms: [Room]
    let favorites: Favorites
    let sharedOrder: [String]
}

struct Boost: Codable, Hashable, Identifiable {
    let id: String
    let messageId: String
    let booster: User
    let content: String
    let createdAt: String
}

struct StoredFile: Codable, Hashable {
    let id: String
    let name: String
    let contentType: String
    let byteSize: Int
    let width: Int?
    let height: Int?
    let url: String
    let downloadUrl: String
    let previewUrl: String?

    var isImage: Bool { contentType.hasPrefix("image/") }
}

struct ThreadSummary: Codable, Hashable {
    let count: Int
    let latestAt: String
    let people: [User]
}

struct Message: Codable, Hashable, Identifiable {
    let id: String
    let clientMessageId: String
    let roomId: String
    let creator: User
    let body: String
    let plainText: String
    let mentions: [User]
    let createdAt: String
    let updatedAt: String
    let editedAt: String?
    var boosts: [Boost]
    let attachment: StoredFile?
    let parentId: String?
    let alsoSent: Bool?
    let parentText: String?
    let thread: ThreadSummary?
    let deleted: Bool?

    /// Mirrors `isInRoom`: every message but a reply sent only to its thread.
    var isInRoom: Bool { parentId == nil || alsoSent == true }

    var createdDate: Date { EmberDate.parse(createdAt) ?? .distantPast }
}

/// What `/api/session` and `/api/me` answer.
struct UserAnswer: Codable {
    let user: Me
}

/// Every `/api/*` failure answers `{ "error": "..." }`.
struct ProblemAnswer: Codable {
    let error: String
}

enum EmberDate {
    private static let fractional: ISO8601DateFormatter = {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f
    }()
    private static let whole = ISO8601DateFormatter()

    static func parse(_ string: String) -> Date? {
        fractional.date(from: string) ?? whole.date(from: string)
    }
}

/// The reactions the web app offers (`REACTIONS` in the protocol).
let quickReactions = ["👍", "👏", "👋", "💪", "❤️", "😂", "🎉", "🔥"]
