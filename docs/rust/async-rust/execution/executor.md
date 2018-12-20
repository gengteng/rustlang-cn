# 应用：构建执行者

`Futures`是懒惰的，必须积极驱动完成才能做任何事情。驱动`Futures`完成的一种常见方法是在`asyn`函数内部的`await!`，但这只会将问题提升一级：谁将运行从顶级`async`函数返回的`Futures`？答案是我们需要一个`Future`执行者。

`Future`执行者获取一组顶级`Futures`并通过`poll`在`Future`可以取得进展时调用它们来完成。通常，执行者将在开始时执行`poll`一次。当`Futures`通过调用`wake()`表示他们已经准备好取得进展时，他们被放回队列`poll`再次被调用，重复直到`Future`完成。

在本节中，我们将编写自己的简单执行者，能够同时运行大量顶级`Futures`。

对于这个，我们将不得不包括`futures` crate以获得`FutureObj`类型，这是一个动态调度`Future`，类似于`Box<dyn Future<Output = T>>`。`Cargo.toml`应该看起来像这样：

```toml
[package]
name = "xyz"
version = "0.1.0"
authors = ["XYZ Author"]
edition = "2018"

[dependencies]
futures-preview = "0.3.0-alpha.9"
```

接下来，我们需要在`src/main.rs`顶部的以下导入：

```rust
#![feature(arbitrary_self_types, async_await, await_macro, futures_api, pin)]

use {
    futures::future::FutureObj,
    std::{
        future::Future,
        pin::Pin,
        sync::{Arc, Mutex},
        sync::mpsc::{sync_channel, SyncSender, Receiver},
        task::{
            local_waker_from_nonlocal,
            Poll, Wake,
        },
    },
};
```

我们执行者的工作是通过通道发送任务运行。执行者将从通道中提取事件并运行它们。当一个任务准备好做更多的工作（被唤醒）时，它可以通过将自己放回到通道上来安排自己再次被轮询。

在此设计中，执行者本身只需要在通道的接收端接受任务。用户将获得发送端，以便他们可以创建新的`futures`。任务本身只是可以重新安排自己的`futures`，所以我们将它们存储为与发送端配对的`futures`，可以用来重新排队。

```rust
/// Task executor that receives tasks off of a channel and runs them.
struct Executor {
    ready_queue: Receiver<Arc<Task>>,
}

/// `Spawner` spawns new futures onto the task channel.
#[derive(Clone)]
struct Spawner {
    task_sender: SyncSender<Arc<Task>>,
}

/// A future that can reschedule itself to be polled using a channel.
struct Task {
    // In-progress future that should be pushed to completion
    //
    // The `Mutex` is not necessary for correctness, since we only have
    // one thread executing tasks at once. However, `rustc` isn't smart
    // enough to know that `future` is only mutated from one thread,
    // so we use it in order to provide safety. A production executor would
    // not need this, and could use `UnsafeCell` instead.
    future: Mutex<Option<FutureObj<'static, ()>>>,

    // Handle to spawn tasks onto the task queue
    task_sender: SyncSender<Arc<Task>>,
}

fn new_executor_and_spawner() -> (Executor, Spawner) {
    // Maximum number of tasks to allow queueing in the channel at once.
    // This is just to make `sync_channel` happy, and wouldn't be present in
    // a real executor.
    const MAX_QUEUED_TASKS: usize = 10_000;
    let (task_sender, ready_queue) = sync_channel(MAX_QUEUED_TASKS);
    (Executor { ready_queue }, Spawner { task_sender})
}
```

我们还要为 spawner 添加一种方法，以便轻松生成新的`future`。此方法将携带`future`类型，将其包装并放入FutureObj中，创建一个`Arc<Task>`，可以将其排入执行者。

```rust
impl Spawner {
    fn spawn(&self, future: impl Future<Output = ()> + 'static + Send) {
        let future_obj = FutureObj::new(Box::new(future));
        let task = Arc::new(Task {
            future: Mutex::new(Some(future_obj)),
            task_sender: self.task_sender.clone(),
        });
        self.task_sender.send(task).expect("too many tasks queued");
    }
}
```

在排序轮询`futures`时，我们还需要创建一个`LocalWaker`提供轮询。正如任务唤醒部分所讨论的那样，`LocalWakers`负责在`wake`调用后再次调度要轮询的任务。请记住， `LocalWakers`告诉执行者确切地准备了哪个任务，允许他们仅轮询准备好进展的`futures`。创建新的`LocalWaker`最简单方法是实现`Wake`特征，然后使用`local_waker_from_nonlocal`或`local_waker`函数将`Arc<T: Wake>` 转换为`LocalWaker`。让我们为我们的任务实现`Wake`，让它们可以转换成`LocalWakers`并唤醒：

```rust
impl Wake for Task {
    fn wake(arc_self: &Arc<Self>) {
        // Implement `wake` by sending this task back onto the task channel
        // so that it will be polled again by the executor.
        let cloned = arc_self.clone();
        arc_self.task_sender.send(cloned).expect("too many tasks queued");
    }
}
```

当从`Arc<Task>`创建`LocalWaker`时，调用`wake()`会导致`Arc`复制并被发送到任务通道。然后我们的执行者接收任务并进行轮询。让我们实现：


```rust
impl Executor {
    fn run(&self) {
        while let Ok(task) = self.ready_queue.recv() {
            let mut future_slot = task.future.lock().unwrap();
            // Take the future, and if it has not yet completed (is still Some),
            // poll it in an attempt to complete it.
            if let Some(mut future) = future_slot.take() {
                // Create a `LocalWaker` from the task itself
                let lw = local_waker_from_nonlocal(task.clone());
                if let Poll::Pending = Pin::new(&mut future).poll(&lw) {
                    // We're not done processing the future, so put it
                    // back in its task to be run again in the future.
                    *future_slot = Some(future);
                }
            }
        }
    }
}

```

恭喜！我们现在有一个工作的`futures`执行者。我们甚至可以用它来运行`async/await!`代码和自定义`futures`，比如我们之前写的`TimerFuture`：

```rust
fn main() {
    let (executor, spawner) = new_executor_and_spawner();
    spawner.spawn(async {
        println!("howdy!");
        // Wait for our timer future to complete after two seconds.
        await!(TimerFuture::new(Duration::new(2, 0)));
        println!("done!");
    });
    executor.run();
}
```

[task wakeups section]: TODO
