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
            EmberLogo(size: 88)
                .shadow(color: Brand.accent.opacity(0.35), radius: 18)
            VStack(spacing: 4) {
                Text("Sign in to Ember").font(.title2.bold())
                Text("Use the address of your Ember and the account you use on the web.")
                    .font(.callout).foregroundStyle(.secondary)
            }

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
            .scrollContentBackground(.hidden)
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
        .background(
            RadialGradient(colors: [Brand.accent.opacity(0.12), .clear], center: .top, startRadius: 0, endRadius: 520)
        )
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
