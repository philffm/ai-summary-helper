import SwiftUI
import UIKit

/// "Sync": the library the browser keeps in an encrypted place, joined with the code it shows for a phone.
struct LibrarySyncView: View {
    @Environment(SyncModel.self) private var sync
    @State private var asking = false

    var body: some View {
        Group {
            if sync.joining || (sync.fetching && sync.state?.last?.at == nil) {
                running
            } else if let offer = sync.offer {
                found(offer)
            } else if let state = sync.state {
                connected(state)
            } else {
                start
            }
        }
        .navigationTitle("Sync")
        .navigationBarTitleDisplayMode(.inline)
        .task { await sync.refresh() }
    }

    // MARK: - Not connected

    private var start: some View {
        List {
            Section {
                VStack(spacing: 10) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 32, weight: .semibold))
                        .foregroundStyle(Color(.systemBackground))
                        .frame(width: 68, height: 68)
                        .background(KaivoTokens.accent, in: RoundedRectangle(cornerRadius: 17, style: .continuous))
                        .accessibilityHidden(true)
                    Text("Your library from the computer").font(.title2.weight(.bold)).accessibilityAddTraits(.isHeader)
                    Text("Articles and highlights from your encrypted place on Nextcloud, WebDAV or S3.").foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            }
            Section {
                Label("On your computer, in Kaivo: Settings → Backup & sync → your place", systemImage: "1.circle")
                Label("Show code for the phone", systemImage: "2.circle")
                Label("Scan the QR code with the camera of this device", systemImage: "3.circle")
            } footer: {
                problem
            }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                primary("Paste code") { Task { await sync.read(UIPasteboard.general.string ?? "") } }
                    .disabled(!sync.available)
                Text("No place yet? You set it up on your computer.").font(.footnote).foregroundStyle(.secondary)
            }
            .padding([.horizontal, .bottom], 16)
        }
    }

    // MARK: - A code has been read

    private func found(_ offer: SyncModel.Offer) -> some View {
        @Bindable var sync = sync
        return List {
            Section("From the code") {
                LabeledContent("Server") { Text(verbatim: offer.info.server) }
                LabeledContent("Type") { Text(verbatim: offer.info.service == "s3" ? "S3" : "Nextcloud / WebDAV") }
                LabeledContent("Folder") { Text(verbatim: offer.info.folder) }
            }
            if offer.info.words {
                Section { Label("The passphrase is part of the code.", systemImage: "key") } footer: { problem }
            } else {
                Section {
                    SecureField("Six words", text: $sync.passphrase)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityLabel("Passphrase")
                        .accessibilityIdentifier("passphrase")
                        .onSubmit { Task { await sync.connect() } }
                } header: {
                    Text("Passphrase")
                } footer: {
                    VStack(alignment: .leading, spacing: 8) {
                        problem
                        Text("The words Kaivo showed you when the place was made. Spaces or dashes both work.")
                    }
                }
            }
            if sync.state != nil {
                Section { Text("Connecting replaces the library you are connected to now.").font(.footnote) }
            }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                Text("For now Kaivo only fetches. Nothing on the server changes.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                primary("Connect") { Task { await sync.connect() } }
                    .disabled(!offer.info.words && sync.passphrase.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Cancel") { sync.back() }.frame(minHeight: 44)
            }
            .padding([.horizontal, .bottom], 16)
        }
    }

    // MARK: - Fetching

    private var running: some View {
        VStack(spacing: 16) {
            Text("Fetching your library").font(.title2.weight(.bold)).accessibilityAddTraits(.isHeader)
            if let progress = sync.progress, progress.total > 0 {
                ProgressView(value: Double(min(progress.done, progress.total)), total: Double(progress.total))
                Text("\(String(progress.done)) of \(String(progress.total)) entries").monospacedDigit()
            } else {
                ProgressView()
            }
            Text("You can keep using the app.").font(.footnote).foregroundStyle(.secondary)
        }
        .multilineTextAlignment(.center)
        .padding(32)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
    }

    // MARK: - Connected

    private func connected(_ state: LibrarySync.State) -> some View {
        List {
            Section {
                HStack(spacing: 12) {
                    Image(systemName: "checkmark.circle.fill").font(.largeTitle).foregroundStyle(KaivoTokens.accent).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Connected").font(.headline)
                        Text(verbatim: "\(state.server ?? "") · \(state.root)").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                .accessibilityElement(children: .combine)
            }
            Section {
                LabeledContent("Articles") { Text(verbatim: state.articles.formatted()) }
                LabeledContent("Last fetched") {
                    if let date = state.last?.at.flatMap(FeedParser.parseDate) {
                        Text(date, format: .relative(presentation: .named))
                    } else {
                        Text("Not fetched yet")
                    }
                }
            }
            Section {
                Button {
                    Task { await sync.fetch() }
                } label: {
                    HStack {
                        Text("Sync now")
                        if sync.fetching {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(sync.fetching)
            } footer: {
                VStack(alignment: .leading, spacing: 8) {
                    problem
                    Text("What you read and mark here stays on this device for now.")
                }
            }
            Section {
                Button("Disconnect…", role: .destructive) { asking = true }
                    .disabled(sync.fetching)
                    .confirmationDialog("The login is deleted from this device. Fetched articles stay.", isPresented: $asking, titleVisibility: .visible) {
                        Button("Disconnect", role: .destructive) { Task { await sync.leave() } }
                        Button("Cancel", role: .cancel) {}
                    }
            }
        }
    }

    // MARK: -

    @ViewBuilder
    private var problem: some View {
        if let problem = sync.problem {
            Group {
                switch problem {
                case .notACode: Text("This is not a Kaivo library code.")
                case .wrongWords: Text("The passphrase does not fit this place. Nothing was changed.")
                case .noLibrary: Text("There is no Kaivo library in that folder yet. Set up sync on your computer first.")
                case .login: Text("The server did not accept the login.")
                case .needsHTTPS: Text("This address needs https.")
                case .other(let said): Text(verbatim: said)
                }
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.red)
        }
    }

    private func primary(_ title: LocalizedStringKey, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title).font(.body.weight(.semibold)).frame(maxWidth: .infinity, minHeight: 36)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
        .controlSize(.large)
    }
}
