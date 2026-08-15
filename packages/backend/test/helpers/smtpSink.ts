import net from 'node:net';

/** Minimal SMTP sink: enough of RFC 5321 for nodemailer to complete a delivery, so the test
 *  exercises the real transport instead of a stub. Captures each message body. */
export interface SmtpSink {
  port: number;
  received: string[];
  close: () => void;
}

export function startSmtpSink(): Promise<SmtpSink> {
  const received: string[] = [];
  const server = net.createServer((socket: net.Socket) => {
    let inData = false;
    let buffer = '';
    let body = '';
    socket.write('220 sink ESMTP\r\n');

    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString();
      let idx: number;
      while ((idx = buffer.indexOf('\r\n')) !== -1) {
        const line = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);

        if (inData) {
          if (line === '.') {
            inData = false;
            received.push(body);
            body = '';
            socket.write('250 OK queued\r\n');
          } else {
            body += line + '\n';
          }
          continue;
        }

        const verb = line.slice(0, 4).toUpperCase();
        if (verb === 'EHLO' || verb === 'HELO') socket.write('250-sink\r\n250 AUTH PLAIN LOGIN\r\n');
        else if (verb === 'AUTH') socket.write('235 authenticated\r\n');
        else if (verb === 'MAIL' || verb === 'RCPT') socket.write('250 OK\r\n');
        else if (verb === 'DATA') { inData = true; socket.write('354 send it\r\n'); }
        else if (verb === 'QUIT') { socket.write('221 bye\r\n'); socket.end(); }
        else socket.write('250 OK\r\n');
      }
    });
    socket.on('error', () => { /* client hangs up after QUIT */ });
  });

  return new Promise<SmtpSink>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({ port, received, close: () => server.close() });
    });
  });
}
