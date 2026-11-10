import SwiftUI

struct SignInView: View {
    @Environment(AppState.self) private var state
    @State private var email = ""
    @State private var password = ""
    @State private var error: String?
    @State private var working = false

    var body: some View {
        @Bindable var state = state
        VStack(spacing: 18) {
            Image(systemName: "flame.fill")
                .font(.system(size: 44))
                .foregroundStyle(.orange)
            Text("Sign in to Ember").font(.title2.bold())

            Form {
                TextField("Server", text: $state.serverText, prompt: Text("chat.example.com"))
                    .textContentType(.URL)
                TextField("Email", text: $email, prompt: Text("you@example.com"))
                    .textContentType(.username)
                SecureField("Password", text: $password)
                    .textContentType(.password)
                    .onSubmit(signIn)
            }
            .formStyle(.grouped)
            .frame(width: 380)
            .scrollDisabled(true)
            .fixedSize(horizontal: false, vertical: true)

            if let error {
                Text(error).foregroundStyle(.red).font(.callout).multilineTextAlignment(.center).frame(maxWidth: 360)
            }

            Button(action: signIn) {
                if working { ProgressView().controlSize(.small) } else { Text("Sign in").frame(minWidth: 120) }
            }
            .keyboardShortcut(.defaultAction)
            .controlSize(.large)
            .disabled(working || email.isEmpty || password.isEmpty || state.serverText.isEmpty)
        }
        .padding(40)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private func signIn() {
        guard !working else { return }
        working = true
        error = nil
        Task {
            defer { working = false }
            do {
                try await state.signIn(email: email, password: password)
                password = ""
            } catch {
                self.error = error.localizedDescription
            }
        }
    }
}
