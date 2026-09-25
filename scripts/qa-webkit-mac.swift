import AppKit
import WebKit

final class Probe: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
    let app = NSApplication.shared
    let window: NSWindow
    let webView: WKWebView
    var errors: [String] = []

    override init() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(GameAssetSchemeHandler(), forURLScheme: "retrosnake")
        config.userContentController.addUserScript(WKUserScript(source: """
          window.addEventListener('error', e => window.webkit.messageHandlers.log.postMessage(String(e.message)));
          window.addEventListener('unhandledrejection', e => window.webkit.messageHandlers.log.postMessage(String(e.reason)));
        """, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 393, height: 852),
                          styleMask: [.titled], backing: .buffered, defer: false)
        webView = WKWebView(frame: window.contentView!.bounds, configuration: config)
        super.init()
        config.userContentController.add(self, name: "log")
        webView.navigationDelegate = self
        window.contentView = webView
        app.setActivationPolicy(.accessory)
        window.orderFrontRegardless()
        webView.load(URLRequest(url: URL(string: "retrosnake://app/index.html")!))
        check(remaining: 30)
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        errors.append(String(describing: message.body))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        errors.append(error.localizedDescription)
    }

    func check(remaining: Int) {
        DispatchQueue.main.asyncAfter(deadline: .now() + 1) {
            self.webView.evaluateJavaScript("""
              (() => {
                const canvas = document.querySelector('#view');
                const game = window.retrosnake;
                return { title: document.title, arena: !!document.querySelector('.arena-hud.era-0'),
                  quality: game?.engine.quality,
                  ratio: canvas ? canvas.width / canvas.clientWidth : 0,
                  expectedRatio: Math.min(window.devicePixelRatio, 3),
                  loader: document.querySelector('#loader .status')?.textContent };
              })()
            """) { value, error in
                if let error { self.errors.append(error.localizedDescription) }
                if let result = value as? [String: Any], result["arena"] as? Bool == true {
                    let quality = (result["quality"] as? NSNumber)?.intValue ?? -1
                    let ratio = (result["ratio"] as? NSNumber)?.doubleValue ?? 0
                    let expected = (result["expectedRatio"] as? NSNumber)?.doubleValue ?? -1
                    let passed = quality == 3 && abs(ratio - expected) < 0.02 && self.errors.isEmpty
                    print("\(passed ? "PASS" : "FAIL"): \(result) errors=\(self.errors)")
                    exit(passed ? 0 : 1)
                }
                if remaining <= 1 {
                    print("FAIL: \(String(describing: value)) errors=\(self.errors)")
                    exit(1)
                }
                self.check(remaining: remaining - 1)
            }
        }
    }
}

let probe = Probe()
withExtendedLifetime(probe) { NSApplication.shared.run() }
