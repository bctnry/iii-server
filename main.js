const tls = require('tls');
const url = require('url');
const path = require('path');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('config.json'));

const options = {
    key: fs.readFileSync(config.serverKey, 'utf-8'),
    cert: fs.readFileSync(config.serverCert, 'utf-8'),
    passphrase: config.serverKeyPassword,
  
    rejectUnauthorized: false,
};

const log = (str) => {
    console.log(`[${new Date(Date.now()).toISOString()}] ${str}`);
}
const error = (x) => {
    console.error(`[${new Date(Date.now()).toISOString()}] ${x}`);
}

const isFullRequest = (x) => x.search('\r\n') !== -1;

const determineMIME = (x) => {
    let extn = path.extname(x);
    return {
        '.gmi': 'text/gemini',
        '.htm': 'text/html',
        '.html': 'text/html',
        '.txt': 'text/plain',
        '.png': 'image/png',
        '.jpeg': 'image/jpeg',
        '.jpg': 'image/ipeg',
        '.svg': 'image/svg+xml',
        '.bmp': 'image/bmp',
        '.gif': 'image/gif',
    }[extn];
}
const isServableMIME = (x) => {
    return [
        'text/gemini',
        'text/html',
        'text/plain',
        'image/png',
        'image/jpeg',
        'image/ipeg',
        'image/svg+xml',
        'image/bmp',
        'image/gif',
    ].includes(x);
}

let proxyCSS = '';
try {
    if (config.proxy.css && typeof config.proxy.css === 'string' && config.proxy.css.trim()) {
        proxyCSS = fs.readFileSync(config.proxy.css);
    }
} catch (e) {
    // intentionally left blank.
}
let cssString = proxyCSS? `<style>${proxyCSS}</style>` : '';

const server = tls.createServer(options, (socket) => {
    log(`${socket.remoteAddress} connected ${socket.authorized ? 'authorized' : 'unauthorized'}`);
    socket.setEncoding('utf8');
    let res = '';
    socket.on('data', (data) => {
        res = `${res}${data}`;
        
        if (!isFullRequest(res)) { return; }
        
        log(`Data ${res.trim()} requested`);
        let resData = res;
        try {
            let reqUrl = new url.URL(resData.trim(), `gemini://${config.host}`);
            if (reqUrl.hostname !== config.host) {
                socket.write('53 No proxy request please\r\n');
                socket.end();
                return;
            }
            
            try {
                for (let i = 0; i < config.block.length; i++) {
                    if (reqUrl.pathname.startsWith(config.block[i])) {
                        // pretend that it isn't here...
                        socket.write('51 Not found\r\n');
                        socket.end();
                        return;
                    }
                }
                let localContentPath = path.join(config.content, reqUrl.pathname);
                let stat = fs.statSync(localContentPath);
                if (stat.isDirectory()) {
                    if (config.autoListDirectory) {
                        let z = fs.readdirSync(localContentPath);
                        socket.write(`20 \r\n`);
                        socket.write(`# Directory ${reqUrl.pathname}\n`);
                        z.forEach((v) => {
                            socket.write(`=> ${reqUrl.pathname.substring(1)}/${v} ${v}\n`);
                        });
                        socket.end();
                    } else {
                        socket.write(`30 ${[reqUrl, 'index.gmi'].join('/')}\r\n`);
                        socket.end();
                    }
                } else if (stat.isFile()) {
                    let mime = determineMIME(localContentPath);
                    if (!isServableMIME(mime)) {
                        // pretend that it isn't here...
                        socket.write('51 Not found\r\n');
                        socket.end();
                    } else {
                        // socket.write(Buffer.from("20 \r\n", {encoding: 'utf-8'}));
                        socket.write(`20 ${mime}; charset=${config.defaultCharset||'utf-8'}\r\n`);
                        try {
                            let data = fs.readFileSync(localContentPath);
                            socket.write(data);
                            socket.end();
                        } catch (e) {
                            socket.write('40 Server error\r\n');
                            socket.end();
                        }
                    }
                } else {
                    socket.write('51 Not found\r\n');
                    socket.end();
                }
            } catch (e) {
                log(e);
                if (e.code === 'ENOENT') {
                    socket.write('51 Not found\r\n');
                    socket.end();
                } else {
                    socket.write('40 Server error\r\n');
                    socket.end();
                }
            }

        } catch (e) {
            socket.write('59 Bad request\r\n');
            socket.end();
        }
    });
});

server.listen(1965, () => {
    log('server bound');
});


if (config.proxy.enabled) {
    const http = require('http');
    const gemtext = require('./gemtext');
    const proxy = http.createServer((req, res) => {
        log(`proxy: ${req.url}`);
        let reqUrl = (!req.url || !req.url.substring(1)) && !config.autoListDirectory? '/index.gmi' : req.url;
        let localContentPath = path.join(config.content, reqUrl);
        try {
            let stat = fs.statSync(localContentPath);
            if (stat.isFile()) {
                res.statusCode = 200;
                let mime = determineMIME(localContentPath)||'application/octet-stream';
                try {
                    let data = fs.readFileSync(localContentPath);
                    if (mime === 'text/gemini') {
                        let parsedData = gemtext.parse(data.toString());
                        let processedData = parsedData.generate(gemtext.HTMLGenerator);
                        let titleElementIndex = parsedData.data.findIndex((v) => v._ === 4 && v.level === 1);
                        let title = titleElementIndex === -1? reqUrl : parsedData.data[titleElementIndex].text;
                        console.log(titleElementIndex, title);
                        data = `<html><head><meta charset="utf-8" /><title>${config.siteName} :: ${title}</title>${cssString}</head><body>${processedData}</body></html>`;
                        mime = 'text/html';
                    }
                    res.writeHead(200, {'Content-Type': mime});
                    res.write(data);
                } catch (e) {
                    error(e);
                    res.statusCode = 500;
                    res.write('Internal error');
                }
            } else if (stat.isDirectory()) {
                if (config.autoListDirectory) {
                    let z = fs.readdirSync(localContentPath);
                    let data = `<html><head><meta charset="utf-8"/><title>${config.siteName} :: ${reqUrl}</title>${cssString}</head><body>
<h1>Directory ${reqUrl}</h1><hr />
<pre><a href="..">..</a>\n${z.map((v) => `<a href="${reqUrl.substring(1)}/${v}">${v}</a>`).join('\n')}</pre><hr/><i style="font-family:serif;font-size:80%">generated http frontend with iii-server.</i></body></html>`
                    let mime = 'text/html';
                    res.writeHead(200, {'Content-Type': mime});
                    res.write(data);
                } else {
                    socket.write(`30 ${['/', reqUrl.pathname, 'index.gmi'].join('/')}\r\n`);
                    socket.end();
                }
            } else {
                error(e);
                res.statusCode = 404;
                res.write('Not found');
            }
            res.end();
        } catch (e) {
            error(e);
            res.statusCode = 404;
            res.write('Not found');
            res.end();
        }
    });
    proxy.on('clientError', (err, socket) => {
        socket.end('HTTP/1.1 400 Bad Request');
    });
    proxy.listen(config.proxy.port||1966);
}
