# 应用:简单HTTP服务器

让我们使用`async/ await!`构建一个echo服务器！

首先，请`rustup update nightly`确保您的Rust最新 -- 我们正在使用最前沿的功能，因此保持最新状态至关重要。完成后，运行 `cargo +nightly new async-await-echo`以创建新项目，然后打开生成的`async-await-echo`文件夹。

让我们在`Cargo.toml`文件中添加一些依赖项：

```rust
[dependencies]
// The latest version of the "futures" library, which has lots of utilities
// for writing async code. Enable the "tokio-compat" feature to include the
// functions for using futures 0.3 and async/await with the Tokio library.
futures-preview = { version = "0.3.0-alpha.9", features = "tokio-compat"] }
// Hyper is an asynchronous HTTP library. We'll use it to power our HTTP
// server and to make HTTP requests.
hyper = "0.12.9"
// Tokio is a runtime for asynchronous I/O applications. Hyper uses
// it for the default server runtime. The `tokio` crate also provides an
// an `await!` macro similar to the one in `std`, but it supports `await!`ing
// both futures 0.1 futures (the kind used by Hyper and Tokio) and
// futures 0.3 futures (the kind produced by the new `async`/`await!` language
// feature).
tokio = { version = "0.1.11", features = ["async-await-preview"] }
```

现在我们已经完成依赖项了，让我们开始编写一些代码。打开`src/main.rs`并在文件的顶部启用以下功能：

 ```rust
#![feature(async_await, await_macro, futures_api)]
```

- `async_await` 增加了对 `async fn` 语法的支持。
- `await_macro` 增加了对 `await!` 宏的支持。
- `futures_api` 增加了对 nightly `std::future` 和 `std::task` 模块的支持,这些模块定义了核心Future特征和依赖类型。

另外，我们还要添加一些导入：

```rust
use {
    hyper::{
        // Miscellaneous types from Hyper for working with HTTP.
        Body, Client, Request, Response, Server, Uri,
         // This function turns a closure which returns a future into an
        // implementation of the the Hyper `Service` trait, which is an
        // asynchronous function from a generic `Request` to a `Response`.
        service::service_fn,
         // A function which runs a future to completion using the Hyper runtime.
        rt::run,
    },
    futures::{
        // `TokioDefaultSpawner` tells futures 0.3 futures how to spawn tasks
        // onto the Tokio runtime.
        compat::TokioDefaultSpawner,
         // Extension traits providing additional methods on futures.
        // `FutureExt` adds methods that work for all futures, whereas
        // `TryFutureExt` adds methods to futures that return `Result` types.
        future::{FutureExt, TryFutureExt},
    },
    std::net::SocketAddr,
     // This is the redefinition of the await! macro which supports both
    // futures 0.1 (used by Hyper and Tokio) and futures 0.3 (the new API
    // exposed by `std::future` and implemented by `async fn` syntax).
    tokio::await,
};
```

一旦导入完成，我们就可以开始整理样板，以便我们提供请求服务：

```rust
async fn serve_req(req: Request<Body>) -> Result<Response<Body>, hyper::Error> {
    unimplemented!()
}
async fn run_server(addr: SocketAddr) {
    println!("Listening on http://{}", addr);
     // Create a server bound on the provided address
    let serve_future = Server::bind(&addr)
        // Serve requests using our `async serve_req` function.
        // `serve` takes a closure which returns a type implementing the
        // `Service` trait. `service_fn` returns a value implementing the
        // `Service` trait, and accepts a closure which goes from request
        // to a future of the response. In order to use our `serve_req`
        // function with Hyper, we have to box it and put it in a compatability
        // wrapper to go from a futures 0.3 future (the kind returned by
        // `async fn`) to a futures 0.1 future (the kind used by Hyper).
        .serve(|| service_fn(|req|
            serve_req(req).boxed().compat(TokioDefaultSpawner)
        ));
     // Wait for the server to complete serving or exit with an error.
    // If an error occurred, print it to stderr.
    if let Err(e) = await!(serve_future) {
        eprintln!("server error: {}", e);
    }
}
fn main() {
    // Set the address to run our socket on.
    let addr = SocketAddr::from(([127, 0, 0, 1], 3000));
     // Call our run_server function, which returns a future.
    // As with every `async fn`, we need to run that future in order for
    // `run_server` to do anything. Additionally, since `run_server` is an
    // `async fn`, we need to convert it from a futures 0.3 future into a
    // futures 0.1 future.
    let futures_03_future = run_server(addr);
    let futures_01_future =
        futures_03_future.unit_error().boxed().compat(TokioDefaultSpawner);
     // Finally, we can run the future to completion using the `run` function
    // provided by Hyper.
    run(futures_01_future);
}
```
如果您现在`cargo run`，您应该在终端上看到"Listening on http://127.0.0.1:300"消息。如果您在所选择的浏览器中打开该URL，您将看到"thread ... panicked at 'not yet implemented'." 现在我们只需要实际处理请求。首先，让我们返回一条静态消息：

```rust
async fn serve_req(req: Request<Body>) -> Result<Response<Body>, hyper::Error> {
    // Always return successfully with a response containing a body with
    // a friendly greeting ;)
    Ok(Response::new(Body::from("hello, world!")))
}
```

如果你`cargo run`再次刷新页面，你应该看到"hello, world!" 出现在浏览器中。恭喜！您刚刚在Rust中编写了第一个异步Web服务器。

您还可以检查请求本身，其中包含请求URI，HTTP版本，标头和其他元数据等信息。例如，我们可以打印出请求的URI，如下所示：

```rust
println!("Got request at {:?}", req.uri());
```

你可能已经注意到我们在处理请求时还没有做任何异步 - 我们只是立即回应，所以我们没有利用`async fn`给我们的灵活性。让我们尝试使用`Hyper`的HTTP客户端将用户的请求代理到另一个网站，而不仅仅是返回静态消息。

我们首先解析出我们想要请求的URL：

```rust
let url_str = "http://www.rust-lang.org/en-US/";
let url = url_str.parse::<Uri>().expect("failed to parse URL");
```

然后我们可以创建一个新的`hyper::Client`并使用它来发出`GET`请求，将响应返回给用户：

```rust
let res = await!(Client::new().get(url));
// Return the result of the request directly to the user
println!("request finished --returning response");
res
```

`Client::get`返回`hyper::client::FutureResponse`，他实现了 `Future<Output = Result<Response, Error>>` （或`Future<Item = Response, Error = Error>` 在futures 0.1）。当我们`await!`这个`future`时,`HTTP`请求已发出，当前任务被暂停，并且一旦响应可用，任务就排队等待继续。

现在，如果`cargo run`您在浏览器中打开`http://127.0.0.1:3000/foo`，您将看到Rust主页，以及以下终端输出：

```bash
Listening on http://127.0.0.1:3000
Got request at /foo
making request to http://www.rust-lang.org/en-US/
request finished-- returning response
```

恭喜！您刚刚完成了代理HTTP请求。