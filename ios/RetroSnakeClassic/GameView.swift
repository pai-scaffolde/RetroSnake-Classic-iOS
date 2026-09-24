import SwiftUI
import WebKit

struct GameView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(GameAssetSchemeHandler(), forURLScheme: "retrosnake")
        configuration.allowsInlineMediaPlayback = true
        configuration.defaultWebpagePreferences.allowsContentJavaScript = true
        configuration.userContentController.add(context.coordinator, name: "haptics")

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.scrollView.isScrollEnabled = false
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.10, green: 0.16, blue: 0.06, alpha: 1)
        #if DEBUG
        webView.isInspectable = true
        #endif
        webView.load(URLRequest(url: URL(string: "retrosnake://app/index.html")!))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator() }

    final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
            // iOS may evict the renderer while the app is backgrounded. Reload the bundled game.
            webView.reload()
        }

        func webView(_ webView: WKWebView,
                     decidePolicyFor navigationAction: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = navigationAction.request.url,
                  url.scheme == "retrosnake", url.host == "app" else {
                return .cancel
            }
            return .allow
        }

        func userContentController(_ userContentController: WKUserContentController,
                                   didReceive message: WKScriptMessage) {
            guard message.name == "haptics", let kind = message.body as? String else { return }
            switch kind {
            case "eat": UIImpactFeedbackGenerator(style: .light).impactOccurred()
            case "death": UINotificationFeedbackGenerator().notificationOccurred(.error)
            case "turn": UISelectionFeedbackGenerator().selectionChanged()
            default: break
            }
        }
    }
}
