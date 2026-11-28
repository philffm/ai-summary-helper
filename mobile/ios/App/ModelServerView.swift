import SwiftUI

/// Where summaries come from: a server of one's own, the model set in Kaivo in Safari, or the model on this device.
struct ModelServerView: View {
    var closable = false
    @Environment(\.dismiss) private var dismiss
    @State private var server = ModelServer.saved
    @State private var models: [String] = []
    @State private var checking = false
    @State private var problem: String?
    @State private var safari = SafariModel.load()
    @State private var contact = SafariModel.contact
    @State private var report = SafariModel.report
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage("summaryOwnServer") private var preferOwn = false
    @State private var allowed = AIConsent().hosts
    @State private var device = DeviceModel.state

    private var fromSafari: ModelEndpoint? { safari.flatMap { ModelEndpoint.safari($0) } }
    private var active: ModelEndpoint? {
        ModelEndpoint.choose(safari: fromSafari, own: .own(server), preferOwn: preferOwn, device: .device(device))
    }

    var body: some View {
        Form {
            if device != .unsupported { onDevice }
            Section {
                if let safari {
                    LabeledContent("From Safari") { Text(verbatim: safari.name + " · " + safari.model) }
                    if fromSafari != nil && ModelEndpoint.own(server) != nil {
                        Toggle("Use my own server instead", isOn: $preferOwn)
                    }
                } else {
                    Text("Choose a model in Kaivo in Safari, then open any page there: the app takes it over.")
                    // why nothing is here yet
                    if let contact {
                        Text("Safari last got in touch \(contact.formatted(.relative(presentation: .named))).").font(.footnote).foregroundStyle(.secondary)
                    } else {
                        Text("Safari has not got in touch yet.").font(.footnote).foregroundStyle(.secondary)
                    }
                    if let problem = report?.problem, !problem.isEmpty {
                        Text("The model could not be taken over: \(problem)").font(.footnote).foregroundStyle(KaivoTokens.dangerText)
                    }
                }
            } footer: {
                if safari != nil && fromSafari == nil {
                    Text("The model set in Safari points at this device itself, which the app cannot reach.")
                } else if let active, active.format != .device {
                    Text("The text of an article you summarize is sent to \(active.name).")
                }
            }
            Section {
                TextField(text: $server.address, prompt: Text(verbatim: "192.168.1.20:11434")) { Text("Address") }
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .onSubmit { Task { await check() } }
                Button {
                    Task { await check() }
                } label: {
                    HStack {
                        Text("Connect")
                        if checking {
                            Spacer()
                            ProgressView()
                        }
                    }
                }
                .disabled(checking || server.base == nil)
            } header: {
                Text("Own server")
            } footer: {
                if let problem {
                    Text(verbatim: problem).foregroundStyle(KaivoTokens.dangerText)
                } else {
                    Text("Ollama or LM Studio on a computer in your network. Ollama must be started with OLLAMA_HOST=0.0.0.0; then everyone in that network can use it.")
                }
            }
            if !models.isEmpty || !server.model.isEmpty {
                Section {
                    Picker("Model", selection: $server.model) {
                        ForEach(models.contains(server.model) || server.model.isEmpty ? models : [server.model] + models, id: \.self) { Text(verbatim: $0).tag($0) }
                    }
                }
            }
            if !allowed.isEmpty {
                Section {
                    ForEach(allowed, id: \.self) { host in
                        LabeledContent {
                            Button("Withdraw") {
                                AIConsent().withdraw(host)
                                allowed = AIConsent().hosts
                            }
                            .buttonStyle(.borderless)
                        } label: {
                            Text(verbatim: host)
                        }
                    }
                } header: {
                    Text("Allowed to receive text")
                }
            }
        }
        .navigationTitle("Model")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { if closable { Button("Done") { dismiss() } } }
        .onChange(of: server) { _, value in value.save() }
        .onAppear(perform: look)
        .onChange(of: scenePhase) { _, phase in if phase == .active { look() } }
    }

    /// Whether the device's own model can write, and whether it is the one that does.
    private var onDevice: some View {
        Section {
            HStack(spacing: 12) {
                Image(systemName: "iphone.gen3").font(.title3).foregroundStyle(device == .ready ? KaivoTokens.accent : .secondary).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    switch device {
                    case .ready:
                        Text(verbatim: "Apple Intelligence")
                        Group {
                            if active?.format == .device { Text("Ready · in use") } else { Text("Ready · another model comes first") }
                        }
                        .font(.footnote).foregroundStyle(.secondary)
                    case .off:
                        Text("Apple Intelligence is off")
                        Text("Switch it on in Settings → Apple Intelligence & Siri. The device then fetches the model.").font(.footnote).foregroundStyle(.secondary)
                    case .loading:
                        Text("The model is still being fetched")
                        Text("The device does that by itself.").font(.footnote).foregroundStyle(.secondary)
                    case .notEligible, .unsupported:
                        Text("Not possible").foregroundStyle(.secondary)
                        Text("This device does not support Apple Intelligence. Set up a server below.").font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Spacer(minLength: 0)
                if active?.format == .device { Image(systemName: "checkmark").fontWeight(.bold).foregroundStyle(KaivoTokens.accent).accessibilityLabel("In use") }
                if device == .loading { ProgressView() }
            }
            .accessibilityElement(children: .combine)
            .accessibilityIdentifier("device-model")
        } header: {
            Text("On this device")
        } footer: {
            if device == .ready { Text("The text stays on this device. No key, no cost.") }
        }
    }

    private func look() {
        device = DeviceModel.state
        safari = SafariModel.load()
        allowed = AIConsent().hosts
        contact = SafariModel.contact
        report = SafariModel.report
    }

    private func check() async {
        checking = true
        defer { checking = false }
        do {
            models = try await ModelClient().models(of: server)
            problem = nil
            if !models.contains(server.model) { server.model = models.first ?? "" }
        } catch {
            models = []
            problem = error.localizedDescription
        }
    }
}
