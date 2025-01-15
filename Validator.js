import crypto from 'crypto';

class Validator {
  constructor(tebexSecret, tebexIPs) {
    this.tebexSecret = tebexSecret;
    this.tebexIPs = tebexIPs;
  }

  validateTebexIP(req) {
    const forwardedFor = req.headers['x-forwarded-for'];
    const ip = forwardedFor ? forwardedFor.split(',')[0] : req.connection.remoteAddress;
    return this.tebexIPs.includes(ip);
  }

  validateSignature(rawBody, signature) {
    const bodyHash = crypto.createHash('sha256').update(rawBody).digest('hex');
    const expectedSignature = crypto
      .createHmac('sha256', this.tebexSecret)
      .update(bodyHash)
      .digest('hex');

    return signature === expectedSignature;
  }
}

export default Validator;