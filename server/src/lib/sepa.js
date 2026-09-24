import crypto from 'node:crypto';

// Set di caratteri SEPA (EPC): lettere latine, cifre e / - ? : ( ) . , ' + spazio
const MAP = { à: 'a', è: 'e', é: 'e', ì: 'i', ò: 'o', ù: 'u', À: 'A', È: 'E', É: 'E', Ì: 'I', Ò: 'O', Ù: 'U', '&': '+', '’': "'" };
export const sepaText = (s, max = 70) =>
  String(s || '').split('').map((ch) => MAP[ch] ?? ch).join('')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9/\-?:().,'+ ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);

const x = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const amt = (n) => Number(n).toFixed(2);

export function ibanValid(iban) {
  const s = String(iban || '').replace(/\s/g, '').toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const re = (s.slice(4) + s.slice(0, 4)).replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let mod = 0;
  for (const d of re) mod = (mod * 10 + Number(d)) % 97;
  return mod === 1;
}

/**
 * Genera un file pain.008.001.02 (SEPA Direct Debit Core).
 * creditor: { name, iban, bic, id }
 * items: [{ endToEndId, amount, mandateId, mandateDate, seqType:'FRST'|'RCUR', debtorName, debtorIban, debtorBic, remittance }]
 */
export function buildPain008({ msgId, creditor, collectionDate, items }) {
  const now = new Date().toISOString().slice(0, 19);
  const total = items.reduce((a, i) => a + Number(i.amount), 0);
  const groups = ['FRST', 'RCUR'].map((seq) => ({ seq, items: items.filter((i) => i.seqType === seq) })).filter((g) => g.items.length);
  const pmtInf = groups.map((g, gi) => {
    const sum = g.items.reduce((a, i) => a + Number(i.amount), 0);
    return `
    <PmtInf>
      <PmtInfId>${x(`${msgId}-${gi + 1}`)}</PmtInfId>
      <PmtMtd>DD</PmtMtd>
      <BtchBookg>true</BtchBookg>
      <NbOfTxs>${g.items.length}</NbOfTxs>
      <CtrlSum>${amt(sum)}</CtrlSum>
      <PmtTpInf>
        <SvcLvl><Cd>SEPA</Cd></SvcLvl>
        <LclInstrm><Cd>CORE</Cd></LclInstrm>
        <SeqTp>${g.seq}</SeqTp>
      </PmtTpInf>
      <ReqdColltnDt>${collectionDate}</ReqdColltnDt>
      <Cdtr><Nm>${x(sepaText(creditor.name))}</Nm></Cdtr>
      <CdtrAcct><Id><IBAN>${creditor.iban}</IBAN></Id></CdtrAcct>
      <CdtrAgt><FinInstnId>${creditor.bic ? `<BIC>${x(creditor.bic)}</BIC>` : '<Othr><Id>NOTPROVIDED</Id></Othr>'}</FinInstnId></CdtrAgt>
      <ChrgBr>SLEV</ChrgBr>
      <CdtrSchmeId><Id><PrvtId><Othr><Id>${x(creditor.id)}</Id><SchmeNm><Prtry>SEPA</Prtry></SchmeNm></Othr></PrvtId></Id></CdtrSchmeId>${g.items.map((i) => `
      <DrctDbtTxInf>
        <PmtId><EndToEndId>${x(i.endToEndId)}</EndToEndId></PmtId>
        <InstdAmt Ccy="EUR">${amt(i.amount)}</InstdAmt>
        <DrctDbtTx><MndtRltdInf><MndtId>${x(sepaText(i.mandateId, 35))}</MndtId><DtOfSgntr>${i.mandateDate}</DtOfSgntr></MndtRltdInf></DrctDbtTx>
        <DbtrAgt><FinInstnId>${i.debtorBic ? `<BIC>${x(i.debtorBic)}</BIC>` : '<Othr><Id>NOTPROVIDED</Id></Othr>'}</FinInstnId></DbtrAgt>
        <Dbtr><Nm>${x(sepaText(i.debtorName))}</Nm></Dbtr>
        <DbtrAcct><Id><IBAN>${i.debtorIban}</IBAN></Id></DbtrAcct>
        <RmtInf><Ustrd>${x(sepaText(i.remittance, 140))}</Ustrd></RmtInf>
      </DrctDbtTxInf>`).join('')}
    </PmtInf>`;
  }).join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:pain.008.001.02" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <CstmrDrctDbtInitn>
    <GrpHdr>
      <MsgId>${x(msgId)}</MsgId>
      <CreDtTm>${now}</CreDtTm>
      <NbOfTxs>${items.length}</NbOfTxs>
      <CtrlSum>${amt(total)}</CtrlSum>
      <InitgPty><Nm>${x(sepaText(creditor.name))}</Nm></InitgPty>
    </GrpHdr>${pmtInf}
  </CstmrDrctDbtInitn>
</Document>
`;
}

export const newMsgId = () => `TDCASH-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
