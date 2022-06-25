import { Socket } from 'net';
import { createServer, Server } from 'http';
import { createDeflate, createGzip } from 'zlib';
import { createReadStream } from 'fs';
import { setTimeout } from 'timers/promises';
import busboy from 'busboy';
import iconv from 'iconv-lite';
import { readableToBytes } from '../utils';

export async function startServer(options?: {
  keepAliveTimeout?: number;
}): Promise<{ server: Server, url: string, closeServer: any }> {
  const server = createServer(async (req, res) => {
    const startTime = Date.now();
    if (server.keepAliveTimeout) {
      res.setHeader('Keep-Alive', 'timeout=' + server.keepAliveTimeout / 1000);
    }
    const urlObject = new URL(req.url!, `http://${req.headers.host}`);
    const pathname = urlObject.pathname;
    res.setHeader('X-Foo', 'bar');
    res.setHeader('x-href', urlObject.href);
    res.setHeader('x-method', req.method ?? '');
    res.setHeader('x-request-headers', JSON.stringify(req.headers));

    if (pathname === '/block') {
      return;
    }

    const timeout = urlObject.searchParams.get('timeout');

    if (pathname === '/mock-bytes') {
      const size = urlObject.searchParams.get('size') ?? '1024';
      const bytes = Buffer.alloc(parseInt(size));
      if (timeout) {
        res.write(bytes);
        await setTimeout(parseInt(timeout));
        res.end();
      } else {
        res.end(bytes);
      }
      return;
    }

    if (timeout) {
      await setTimeout(parseInt(timeout));
    }

    if (pathname === '/wrongjson') {
      res.setHeader('content-type', 'application/json');
      return res.end(Buffer.from('{"foo":""'));
    }

    if (pathname === '/html') {
      res.setHeader('content-type', 'text/html');
      return res.end('<h1>hello</h1>');
    }

    if (pathname === '/redirect') {
      res.setHeader('Location', '/redirect-to-url');
      res.statusCode = 302;
      return res.end('Redirect to /redirect-to-url');
    }
    if (pathname === '/redirect-301') {
      res.setHeader('Location', '/redirect-301-to-url');
      res.statusCode = 301;
      return res.end('Redirect to /redirect-301-to-url');
    }
    if (pathname === '/redirect-full') {
      const url = `http://${req.headers.host}/redirect-full-to-url`;
      res.setHeader('Location', url);
      res.statusCode = 302;
      return res.end(`Redirect to ${url}`);
    }
    if (pathname === '/redirect-full-301') {
      const url = `http://${req.headers.host}/redirect-full-301-to-url`;
      res.setHeader('Location', url);
      res.statusCode = 301;
      return res.end(`Redirect to ${url}`);
    }

    if (pathname === '/socket.end.error') {
      res.write('foo haha\n');
      await setTimeout(200);
      res.write('foo haha 2');
      await setTimeout(200);
      res.socket!.end('balabala');
      return;
    }
    
    if (pathname === '/wrongjson-gbk') {
      res.setHeader('content-type', 'application/json');
      createReadStream(__filename).pipe(res);
      return
    }
    if (pathname === '/json_with_controls_unicode') {
      return res.end(Buffer.from('{"foo":"\b\f\n\r\tbar\u000e!1!\u0086!2!\u0000!3!\u001F!4!\u005C!5!end\u005C\\"}'));
    }
    if (pathname === '/json_with_t') {
      return res.end(Buffer.from('{"foo":"ba\tr\t\t"}'));
    }
    if (pathname === '/gbk/json') {
      res.setHeader('Content-Type', 'application/json;charset=gbk');
      const content = iconv.encode(JSON.stringify({ hello: '你好' }), 'gbk');
      return res.end(content);
    }
    if (pathname === '/gbk/text') {
      res.setHeader('Content-Type', 'text/plain;charset=gbk');
      const content = iconv.encode('你好', 'gbk');
      return res.end(content);
    }
    if (pathname === '/errorcharset') {
      res.setHeader('Content-Type', 'text/plain;charset=notfound');
      return res.end('你好');
    }

    if (pathname === '/deflate') {
      res.setHeader('Content-Encoding', 'deflate');
      createReadStream(__filename).pipe(createDeflate()).pipe(res);
      return;
    }
    if (pathname === '/gzip') {
      res.setHeader('Content-Encoding', 'gzip');
      createReadStream(__filename).pipe(createGzip()).pipe(res);
      return;
    }
    if (pathname === '/error-gzip') {
      res.setHeader('Content-Encoding', 'gzip');
      createReadStream(__filename).pipe(res);
      return;
    }

    if (pathname === '/multipart' && (req.method === 'POST' || req.method === 'PUT')) {
      const bb = busboy({ headers: req.headers });
      const result = {
        method: req.method,
        url: req.url,
        href: urlObject.href,
        headers: req.headers,
        files: {},
        form: {},
      };
      bb.on('file', (name, file, info) => {
        const { filename, encoding, mimeType } = info;
        // console.log(`File [${name}]: info %j`, info);
        let size = 0;
        file.on('data', data => {
          // console.log(`File [${name}] got ${data.length} bytes`);
          size += data.length;
        }).on('close', () => {
          // console.log(`File [${name}] done`);
          result.files[name] = {
            filename,
            encoding,
            mimeType,
            size,
          };
        });
      });
      bb.on('field', (name, val) => {
        // console.log(`Field [${name}]: value length: %d, info: %j`, val.length, info);
        result.form[name] = val;
      });
      bb.on('close', () => {
        // console.log('Done parsing form!');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
      });
      req.pipe(bb);
      return;
    }

    if (pathname === '/raw') {
      req.pipe(res);
      return;
    }

    let requestBody: any;
    let requestBytes: Buffer = Buffer.from('');
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      requestBytes = await readableToBytes(req);
    }

    if (req.headers['content-type']?.startsWith('application/x-www-form-urlencoded')) {
      const searchParams = new URLSearchParams(requestBytes.toString());
      requestBody = {};
      for (const [ field, value ] of searchParams.entries()) {
        requestBody[field] = value;
      }
    } else if (req.headers['content-type']?.startsWith('application/json')) {
      requestBody = JSON.parse(requestBytes.toString());
    } else {
      requestBody = requestBytes.toString();
    }
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'x-rt': `${Date.now() - startTime}`,
    });
    res.end(JSON.stringify({
      method: req.method,
      url: req.url,
      href: urlObject.href,
      headers: req.headers,
      requestBody,
    }));
  });
  if (options?.keepAliveTimeout) {
    server.keepAliveTimeout = options.keepAliveTimeout;
  }

  // handle active connection on Node.js 16
  const hasCloseAllConnections = !!(server as any).closeAllConnections;
  const connections: Socket[] = [];
  if (!hasCloseAllConnections) {
    server.on('connection', connection => {
      connections.push(connection);
    });
  }

  return new Promise(resolve => {
    server.listen(0, () => {
      const address: any = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}/`,
        server,
        closeServer() {
          if (hasCloseAllConnections) {
            (server as any).closeAllConnections();
          } else {
            console.log('Closing %d http connections', connections.length);
            for (const connection of connections) {
              connection.destroy();
            }
          }
          return new Promise(resolve => {
            server.close(resolve);
          });
        },
      });
    });
  });
}