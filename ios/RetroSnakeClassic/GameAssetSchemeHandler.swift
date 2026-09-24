import Foundation
import WebKit

/// Serves the packaged game as one offline origin, including ES modules and 3D assets.
final class GameAssetSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.resourceURL!.appendingPathComponent("GameAssets", isDirectory: true)

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url,
              url.scheme == "retrosnake", url.host == "app" else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        let path = url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let resource = root.appendingPathComponent(path).standardizedFileURL
        guard resource.path.hasPrefix(root.standardizedFileURL.path + "/"),
              let data = try? Data(contentsOf: resource) else {
            urlSchemeTask.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let response = URLResponse(url: url, mimeType: mimeType(for: resource.pathExtension),
                                   expectedContentLength: data.count, textEncodingName: nil)
        urlSchemeTask.didReceive(response)
        urlSchemeTask.didReceive(data)
        urlSchemeTask.didFinish()
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func mimeType(for ext: String) -> String {
        switch ext.lowercased() {
        case "html": "text/html"
        case "js": "text/javascript"
        case "css": "text/css"
        case "json": "application/json"
        case "glb": "model/gltf-binary"
        case "webp": "image/webp"
        case "png": "image/png"
        case "jpg", "jpeg": "image/jpeg"
        case "woff2": "font/woff2"
        case "mp3": "audio/mpeg"
        default: "application/octet-stream"
        }
    }
}
