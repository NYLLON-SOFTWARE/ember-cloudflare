import Foundation

/// One WebSocket that keeps itself open: it pings every 25 seconds, and when the connection drops it
/// reconnects with backoff, asking `makeRequest` for a fresh upgrade request each time (so a room can name
/// the latest `seq` it has seen). Close codes that mean "don't come back" stop it.
@MainActor
final class Socket {
    enum State { case connecting, open, closed }

    private let session: URLSession
    private let makeRequest: () -> URLRequest?
    private let onText: (String) -> Void
    private let onClose: (Int) -> Bool  // return false to stop reconnecting

    private var task: URLSessionWebSocketTask?
    private var pingTimer: Timer?
    private var attempt = 0
    private var stopped = false
    private(set) var state: State = .closed
    var onStateChange: ((State) -> Void)?

    init(session: URLSession, makeRequest: @escaping () -> URLRequest?, onText: @escaping (String) -> Void, onClose: @escaping (Int) -> Bool) {
        self.session = session
        self.makeRequest = makeRequest
        self.onText = onText
        self.onClose = onClose
    }

    func connect() {
        stopped = false
        open()
    }

    func close() {
        stopped = true
        pingTimer?.invalidate()
        task?.cancel(with: .goingAway, reason: nil)
        task = nil
        setState(.closed)
    }

    func send(_ text: String) {
        task?.send(.string(text)) { _ in }
    }

    private func setState(_ new: State) {
        state = new
        onStateChange?(new)
    }

    private func open() {
        guard !stopped, let request = makeRequest() else { return }
        setState(.connecting)
        let task = session.webSocketTask(with: request)
        // A room frame can be up to ~600 KB of message markup; history pages larger still.
        task.maximumMessageSize = 16 << 20
        self.task = task
        task.resume()
        receive(on: task)
        pingTimer?.invalidate()
        pingTimer = Timer.scheduledTimer(withTimeInterval: 25, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.send(#"{"type":"ping"}"#) }
        }
    }

    private func receive(on task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            Task { @MainActor in
                guard let self, self.task === task else { return }
                switch result {
                case let .success(message):
                    if self.state != .open {
                        self.attempt = 0
                        self.setState(.open)
                    }
                    switch message {
                    case let .string(text): self.onText(text)
                    case let .data(data): self.onText(String(decoding: data, as: UTF8.self))
                    @unknown default: break
                    }
                    self.receive(on: task)
                case .failure:
                    self.handleClose(code: task.closeCode.rawValue)
                }
            }
        }
    }

    private func handleClose(code: Int) {
        pingTimer?.invalidate()
        task = nil
        setState(.closed)
        guard !stopped, onClose(code) else { return }
        // 4001 asks to reconnect at once; anything else backs off up to 30 seconds.
        let delay = code == EmberCloseCode.reconnect ? 0.2 : min(30, pow(2, Double(attempt)))
        attempt += 1
        DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
            Task { @MainActor in self?.open() }
        }
    }
}
