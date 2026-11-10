import Foundation

enum APIError: LocalizedError {
    case server(status: Int, message: String)
    case notSignedIn
    case invalidServer

    var errorDescription: String? {
        switch self {
        case let .server(_, message): message
        case .notSignedIn: "Not signed in"
        case .invalidServer: "That doesn't look like an Ember address, such as https://chat.example.com"
        }
    }
}

/// Talks to an Ember Worker's `/api/*` routes.
///
/// Ember signs in with an HttpOnly session cookie (`__Host-session_token` over HTTPS), which
/// `HTTPCookieStorage.shared` keeps between launches. The Worker refuses writes and socket upgrades that
/// don't look same-origin (`isCrossSite` / `isSameOriginUpgrade` in apps/worker/src/auth.ts), so every
/// request carries `Origin: <server>` and `Sec-Fetch-Site: same-origin`, as the web app's pages would.
final class APIClient: @unchecked Sendable {
    let server: URL
    let session: URLSession

    init(server: URL) {
        self.server = server
        let config = URLSessionConfiguration.default
        config.httpCookieStorage = .shared
        config.httpShouldSetCookies = true
        config.httpCookieAcceptPolicy = .always
        session = URLSession(configuration: config)
    }

    /// The server's origin, `https://host[:port]`, which `Origin` must equal.
    var origin: String {
        var components = URLComponents()
        components.scheme = server.scheme
        components.host = server.host
        components.port = server.port
        return components.string ?? server.absoluteString
    }

    /// Normalizes what someone typed into a server address: adds https:// and drops any path.
    static func serverURL(from typed: String) -> URL? {
        var text = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return nil }
        if !text.contains("://") { text = "https://" + text }
        guard var components = URLComponents(string: text), let host = components.host, !host.isEmpty,
              components.scheme == "https" || components.scheme == "http" else { return nil }
        components.path = ""
        components.query = nil
        components.fragment = nil
        return components.url
    }

    func request(_ path: String, method: String = "GET", body: Encodable? = nil) throws -> URLRequest {
        var request = URLRequest(url: server.appendingPathComponent(path))
        request.httpMethod = method
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue(origin, forHTTPHeaderField: "Origin")
        request.setValue("same-origin", forHTTPHeaderField: "Sec-Fetch-Site")
        if let body {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.httpBody = try JSONEncoder().encode(body)
        }
        return request
    }

    func send<T: Decodable>(_ type: T.Type, _ path: String, method: String = "GET", body: Encodable? = nil) async throws -> T {
        let (data, response) = try await session.data(for: try request(path, method: method, body: body))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            if status == 401 && path != "/api/session" { throw APIError.notSignedIn }
            let message = (try? JSONDecoder().decode(ProblemAnswer.self, from: data))?.error
                ?? "The server answered \(status)."
            throw APIError.server(status: status, message: message)
        }
        return try JSONDecoder().decode(T.self, from: data)
    }

    func sendIgnoringBody(_ path: String, method: String, body: Encodable? = nil) async throws {
        let (data, response) = try await session.data(for: try request(path, method: method, body: body))
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(status) else {
            let message = (try? JSONDecoder().decode(ProblemAnswer.self, from: data))?.error ?? "The server answered \(status)."
            throw APIError.server(status: status, message: message)
        }
    }

    // MARK: Routes

    struct PasswordSignIn: Encodable {
        let emailAddress: String
        let password: String
    }

    func signIn(email: String, password: String) async throws -> Me {
        try await send(UserAnswer.self, "/api/session", method: "POST", body: PasswordSignIn(emailAddress: email, password: password)).user
    }

    func me() async throws -> Me {
        try await send(UserAnswer.self, "/api/me").user
    }

    func signOut() async {
        try? await sendIgnoringBody("/api/session", method: "DELETE")
        for cookie in HTTPCookieStorage.shared.cookies(for: server) ?? [] {
            HTTPCookieStorage.shared.deleteCookie(cookie)
        }
    }

    func sidebar() async throws -> Sidebar {
        try await send(Sidebar.self, "/api/sidebar")
    }

    func directory() async throws -> Directory {
        try await send(Directory.self, "/api/users")
    }

    // MARK: Sockets

    /// A WebSocket upgrade request for `path`, carrying the session cookie and the same-origin headers.
    func socketRequest(_ path: String, query: String = "") -> URLRequest? {
        guard var components = URLComponents(url: server.appendingPathComponent(path), resolvingAgainstBaseURL: false) else { return nil }
        components.scheme = server.scheme == "http" ? "ws" : "wss"
        if !query.isEmpty { components.percentEncodedQuery = query }
        guard let url = components.url else { return nil }
        var request = URLRequest(url: url)
        request.setValue(origin, forHTTPHeaderField: "Origin")
        // Attach the cookie by hand: a ws(s):// URL doesn't match the https:// cookie's domain lookup in
        // every macOS release, and the Worker refuses an upgrade without it.
        let cookies = HTTPCookieStorage.shared.cookies(for: server) ?? []
        for (field, value) in HTTPCookie.requestHeaderFields(with: cookies) {
            request.setValue(value, forHTTPHeaderField: field)
        }
        return request
    }

    /// An absolute URL for a path the server hands out, such as an avatar's or a file's.
    func absolute(_ path: String) -> URL? {
        URL(string: path, relativeTo: server)?.absoluteURL
    }
}
