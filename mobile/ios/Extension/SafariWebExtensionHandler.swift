import SafariServices

/// The native side of the Safari Web Extension: saved articles arrive here (bg/nativeLibrary.js) and are put into the
/// folder shared with the app. The extension always starts the conversation; the app cannot call it on iOS.
class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any] ?? [:]
        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: SafariInbox.handle(message)]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }
}
