exports.asyncrust = (title) => {
    return [
        '',
        {
            title: '开始',
            collapsable: true,
            children: [
            'getting_started/chapter',
            'getting_started/why_async',
            'getting_started/async_await_primer',
            'getting_started/http_server_example'
            ]
        },
        {
            title: 'Execution',
            collapsable: true,
            children: [
            'execution/chapter',
            'execution/future',
            'execution/wakeups',
            'execution/executor',
            'execution/io'
            ]
        },
        {
            title: 'Async/Await',
            collapsable: true,
            children: [
            'async_await/chapter'
            ]
        },
        {
            title: 'Pinning',
            collapsable: true,
            children: [
            'pinning/chapter'
            ]
        },
        {
            title: 'Streams',
            collapsable: true,
            children: [
            'streams/chapter'
            ]
        },
        'api'
    ]
}
