import SwiftUI
import UIKit

/// "Sync": the library the browser keeps in an encrypted place, joined with the code it shows for a phone.
struct LibrarySyncView: View {
    @Environment(SyncModel.self) private var sync
    @State private var asking = false
    /// Before writing back is switched on, the backup is asked for.
    @State private var backup = false
    @State private var picking = false

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
        .sheet(isPresented: $backup) { BackupFirst { Task { await sync.setWriteBack(true) } } }
        .fileImporter(isPresented: $picking, allowedContentTypes: [.folder]) { result in
            if case .success(let folder) = result { Task { await sync.read(folder: folder) } }
        }
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
            Section {
                Button { picking = true } label: { Label("Choose a folder", systemImage: "folder") }
                    .disabled(!sync.available)
                    .accessibilityIdentifier("choose-folder")
            } footer: {
                Text("A place in a folder, for example in iCloud Drive? Choose that folder. This iPhone only reads it.")
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
            if offer.info.service == "folder" {
                Section("From Files") {
                    LabeledContent("Folder") { Text(verbatim: offer.info.folder == "." ? offer.info.server : offer.info.server + "/" + offer.info.folder) }
                }
            } else {
                Section("From the code") {
                    LabeledContent("Server") { Text(verbatim: offer.info.server) }
                    LabeledContent("Type") { Text(verbatim: offer.info.service == "s3" ? "S3" : "Nextcloud / WebDAV") }
                    LabeledContent("Folder") { Text(verbatim: offer.info.folder) }
                }
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
                        if offer.info.service == "folder" { Text("On your computer in Kaivo, open your place and choose “Show passphrase”.") }
                    }
                }
            }
            if sync.state != nil {
                Section { Text("Connecting replaces the library you are connected to now.").font(.footnote) }
            }
        }
        .safeAreaInset(edge: .bottom) {
            VStack(spacing: 8) {
                Text(offer.info.service == "folder" ? "This iPhone only reads this folder." : "Connecting only fetches. Writing back stays off until you switch it on.")
                    .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                primary("Connect") { Task { await sync.connect() } }
                    .disabled(!offer.info.words && sync.passphrase.trimmingCharacters(in: .whitespaces).isEmpty)
                Button("Cancel") { sync.back() }.frame(minHeight: 44)
            }
            .padding([.horizontal, .bottom], 16)
        }
    }

    // MARK: - Fetching for the first time

    private var running: some View {
        VStack(spacing: 14) {
            SyncRing()
            Text("Fetching your library").font(.title3.weight(.semibold)).accessibilityAddTraits(.isHeader)
            Text("You can keep using the app.").font(.subheadline).foregroundStyle(.secondary)
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
                VStack(spacing: 12) {
                    SyncRing()
                    Group {
                        if sync.running && sync.sending {
                            Text("Sending to your place")
                        } else if sync.running {
                            Text("Fetching your library")
                        } else if sync.failed {
                            Text("Last sync failed")
                        } else {
                            Text("All up to date")
                        }
                    }
                    .font(.title3.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                    Group {
                        if sync.running {
                            Text("You can keep using the app.")
                        } else if let date = state.last?.at.flatMap(FeedParser.parseDate) {
                            HStack(spacing: 4) {
                                if state.writesBack { Text("Last synced") } else { Text("Last fetched") }
                                Text(date, format: .relative(presentation: .named))
                            }
                        } else if state.writesBack {
                            Text("Not synced yet")
                        } else {
                            Text("Not fetched yet")
                        }
                    }
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                }
                .multilineTextAlignment(.center)
                .frame(maxWidth: .infinity)
                .listRowBackground(Color.clear)
            }
            Section {
                LabeledContent("Articles") { Text(verbatim: state.articles.formatted()) }
                if state.service == "folder" {
                    LabeledContent("Folder") { Text(verbatim: state.root == "." ? state.server ?? "" : (state.server ?? "") + "/" + state.root) }
                } else {
                    LabeledContent("Server") { Text(verbatim: state.server ?? "") }
                    LabeledContent("Folder") { Text(verbatim: state.root) }
                }
            }
            Section {
                Button {
                    Task { await sync.fetch() }
                } label: {
                    Text("Sync now").fontWeight(.semibold).frame(maxWidth: .infinity)
                }
                .disabled(sync.fetching)
            } footer: {
                problem
            }
            if state.service == "folder" {
                Section { Text("This iPhone only reads this folder.").font(.footnote) }
            } else {
            Section {
                Toggle("Write back", isOn: Binding(get: { state.writesBack }, set: { on in
                    if on { backup = true } else { Task { await sync.setWriteBack(false) } }
                }))
                .accessibilityIdentifier("write-back")
            } footer: {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Off: the app only fetches. On: reading progress, highlights, comments, notes, questions and summaries go to your place too, and the articles saved on this iPhone join your library, also those from before.")
                    Text("Deleting on this iPhone does not delete anything in your library yet.")
                }
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
                case .onItsWay: Text("iCloud is still downloading files. Sync again in a moment.")
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

/// Asked before the phone may change the place for the first time: a backup made on the computer.
private struct BackupFirst: View {
    let on: () -> Void
    @Environment(\.dismiss) private var dismiss
    @Environment(SyncModel.self) private var sync
    /// What the switch adds to the library, said before it is switched on.
    @State private var waiting: LibrarySync.Waiting?

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text("From now on this iPhone changes your place. Save your library on your computer first.")
                }
                if let waiting, waiting.articles + waiting.summaries > 0 {
                    Section("Added to your library") {
                        LabeledContent("Articles saved on this iPhone") { Text(verbatim: waiting.articles.formatted()) }
                        LabeledContent("Summaries written on this iPhone") { Text(verbatim: waiting.summaries.formatted()) }
                    }
                }
                Section {
                    Label("Open Kaivo on your computer: Settings", systemImage: "1.circle")
                    Label("Backup & sync", systemImage: "2.circle")
                    Label("Once, as a file → Save to a file, with your articles", systemImage: "3.circle")
                }
                // in the list, so that it never covers the steps, whatever the text size
                Section {
                    Button {
                        on()
                        dismiss()
                    } label: {
                        Text("The backup is made, switch on").frame(maxWidth: .infinity, minHeight: 34)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(KaivoTokens.accent)
                    .listRowInsets(EdgeInsets())
                    .listRowBackground(Color.clear)
                }
            }
            .task { waiting = await sync.waiting() }
            .navigationTitle("A backup first")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } } }
        }
    }
}
