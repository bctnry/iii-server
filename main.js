const tls = require('tls');
const url = require('url');
const path = require('path');
const fs = require('fs');

const config = JSON.parse(fs.readFileSync('config.json'));

const options = {
    key: fs.readFileSync(config.serverKey, 'utf-8'),
    cert: fs.readFileSync(config.serverCert, 'utf-8'),
  
    rejectUnauthorized: false,
};

const log = (str) => {
    console.log(`[${new Date(Date.now()).toISOString()}] ${str}`);
}

const isFullRequest = (x) => x.search('\r\n') !== -1;

const determineMIME = (x) => {
    let extn = path.extname(x);
    return {
        '.gmi': 'text/gemini',
        '.htm': 'text/html',
        '.html': 'text/html',
        '.txt': 'text/plain',
    }[extn];
}
const isServableMIME = (x) => {
    return [
        'text/gemini',
        'text/html',
        'text/plain'
    ].includes(x);
}

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
                    socket.write(`30 ${path.join(reqUrl.pathname, 'index.gmi')}`);
                    socket.end();
                } else if (stat.isFile()) {
                    let mime = determineMIME(localContentPath);
                    if (!isServableMIME(mime)) {
                        // pretend that it isn't here...
                        socket.write('51 Not found\r\n');
                        socket.end();
                    } else {
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
