/* eslint-disable no-console */

const ws = new WebSocket('wss://ws.bitmex.com/realtime?subscribe=instrument');

ws.onopen = () => {
    console.log('connected!');
};

let count = 10;

ws.onmessage = ev => {
    const data = JSON.parse(ev.data);

    console.log(data);

    if (!count--) ws.close();
};
