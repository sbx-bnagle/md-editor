// HTTP for the AI services (apps/ipad/src/http.ts): requests go out from here, with API keys put
// in place of their stand-ins, and replies stream back to the page as they arrive.

import Foundation

final class HttpProxy: NSObject, URLSessionDataDelegate {
    static let shared = HttpProxy()

    private let queue: OperationQueue = {
        let q = OperationQueue()
        q.maxConcurrentOperationCount = 1
        return q
    }()

    private lazy var session: URLSession = {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 600
        config.timeoutIntervalForResource = 3600
        config.requestCachePolicy = .reloadIgnoringLocalCacheData
        return URLSession(configuration: config, delegate: self, delegateQueue: queue)
    }()

    private struct Running {
        let id: String
        let send: ([String: Any]) -> Void
    }

    private let lock = NSLock()
    private var running: [Int: Running] = [:]
    private var tasks: [String: URLSessionDataTask] = [:]

    /** Headers URLSession sets itself. */
    private static let skipped: Set<String> = ["host", "content-length", "connection", "accept-encoding"]

    func start(id: String, url: String, method: String, headers: [String: String], body: Data?, send: @escaping ([String: Any]) -> Void) throws {
        guard let u = URL(string: url), let scheme = u.scheme?.lowercased(), scheme == "https" || scheme == "http" else {
            throw BridgeError("Only web addresses (https://…) can be reached: \(url)", code: "EINVAL")
        }
        var request = URLRequest(url: u)
        request.httpMethod = method
        for (name, value) in headers where !HttpProxy.skipped.contains(name.lowercased()) {
            request.setValue(Keychain.substitute(value), forHTTPHeaderField: name)
        }
        request.httpBody = body
        let task = session.dataTask(with: request)
        lock.lock()
        running[task.taskIdentifier] = Running(id: id, send: send)
        tasks[id] = task
        lock.unlock()
        task.resume()
    }

    func cancel(id: String) {
        lock.lock()
        let task = tasks.removeValue(forKey: id)
        if let task { running.removeValue(forKey: task.taskIdentifier) }
        lock.unlock()
        task?.cancel()
    }

    private func entry(_ task: URLSessionTask) -> Running? {
        lock.lock()
        defer { lock.unlock() }
        return running[task.taskIdentifier]
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        guard let r = entry(dataTask) else { return completionHandler(.cancel) }
        var headers: [String: String] = [:]
        var status = 200
        if let http = response as? HTTPURLResponse {
            status = http.statusCode
            for (k, v) in http.allHeaderFields {
                let name = "\(k)".lowercased()
                // The body arrives decoded and in pieces: its encoding and length no longer apply.
                if name == "content-encoding" || name == "content-length" { continue }
                headers[name] = "\(v)"
            }
        }
        r.send(["type": "http.head", "id": r.id, "status": status, "headers": headers])
        completionHandler(.allow)
    }

    func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        guard let r = entry(dataTask) else { return }
        r.send(["type": "http.data", "id": r.id, "data": data.base64EncodedString()])
    }

    func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let r = running.removeValue(forKey: task.taskIdentifier)
        if let r { tasks.removeValue(forKey: r.id) }
        lock.unlock()
        guard let r else { return }
        var event: [String: Any] = ["type": "http.end", "id": r.id]
        if let error, (error as NSError).code != NSURLErrorCancelled { event["error"] = error.localizedDescription }
        r.send(event)
    }
}
