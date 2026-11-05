// ---------------------------------------------------------------------------
// A VACANCY, NOT A SCRIPT (founder 2026-11-05: "just a script in English - the job vacancy details - and the AI builds the conversation and talks to the candidates").
//
// The team gives the FACTS of an opening in one place, in English:
//     This is an automated AI call.  Role: HR Recruiter; Company: Teamlink Consultants; Location: Kukatpally; Salary: 10K per month;
//     Qualification: Any graduate; Details: sourcing candidates, screening resumes; Contact: Anil Ravali; Next: share your resume on WhatsApp
// and the call is built from them: greeting, "do you have a minute?", the vacancy, "are you interested?", the next step, a try to convince when the answer is no,
// a kind close - in English, Telugu AND Hindi from built-in phrases (nothing is machine-translated, so it is quick and the facts cannot go wrong), and a
// person's questions about the pay, the place, the qualification and the role are answered from the facts. Keys: Role, Company, Location, Salary, Qualification,
// Experience, Details, Benefits, Contact, Next, Language (the language the call starts in: English / Telugu / Hindi).
// ---------------------------------------------------------------------------
const KEYS = {
  role: 'role|position|post|job|designation|vacancy', company: 'company|organization|organisation|firm', location: 'location|place|city|area',
  salary: 'salary|pay|package|ctc', qualification: 'qualification|education', experience: 'experience', details: 'details|responsibilities|duties|work',
  benefits: 'benefits|perks', vacancies: 'vacancies|openings|no of vacancies|number of vacancies', keyreq: 'key requirement|requirement|note', persuasion: 'persuasion|hook|advantage|upside', channel: 'channel|contact channel',
  contact: 'contact|recruiter|manager|contact person', next: 'next|next step', language: 'language|start language',
};
const ALL = Object.values(KEYS).join('|');
const KEY_OF = Object.entries(KEYS).map(([k, v]) => [k, new RegExp(`^(${v})$`, 'i')]);

/** { role, company, ... } when the text is the facts of a vacancy (a role and at least two other facts), else null. */
function parseFacts(raw) {
  const text = String(raw == null ? '' : raw).replace(/\r/g, '\n');
  const re = new RegExp(`(?:^|[\\s;|,.])(${ALL})\\s*[:=]\\s*([^;|\\n]*?)(?=\\s*(?:[;|\\n]|(?:^|\\s)(?:${ALL})\\s*[:=]|$))`, 'gi');
  const facts = {};
  let m = re.exec(text);
  while (m) {
    const key = (KEY_OF.find(([, r]) => r.test(m[1].trim())) || [])[0];
    // a pasted paragraph ends where its next heading begins ("... hiring process Interest check Are you interested ...")
    let value = m[2].split(/[“”"]|\b(?:interest check|if interested|if not interested|if yes|closing)\b/i)[0].replace(/\s+/g, ' ').replace(/[.\s]+$/, '').trim();
    const max = key === 'details' || key === 'benefits' || key === 'next' ? 300 : 70;
    if (value.length > max) value = value.slice(0, max).replace(/[,;\s][^,;\s]*$/, '').trim();
    if (key && value && !facts[key]) facts[key] = value;
    m = re.exec(text);
  }
  const n = Object.keys(facts).length;
  return facts.role && n >= 3 ? facts : null;
}

const L = {
  English: {
    open: (f) => `Hello {name}, good morning. This is an automated AI assistant calling from ${f.company || 'our company'}${f.contact ? ` on behalf of ${f.contact}` : ''}.`,
    perm: () => 'Do you have one minute to talk about a job opportunity?',
    say: (f) => `We have an opening for ${f.role}.${f.location ? ` The location is ${f.location}.` : ''}${f.salary ? ` The salary is ${f.salary}.` : ''}${f.qualification ? ` The qualification needed is ${f.qualification}.` : ''}${f.experience ? ` Experience: ${f.experience}.` : ''}${f.details ? ` The work is ${f.details}.` : ''}${f.benefits ? ` Benefits: ${f.benefits}.` : ''}${f.vacancies ? ` There are ${f.vacancies} position(s) open right now.` : ''}${f.keyreq ? ` One thing to flag for this role: ${f.keyreq}.` : ''}`,
    interest: () => 'Are you interested in this opportunity?',
    loc: (f) => `Where are you currently located?${f.location ? ` Are you open to working at ${f.location}?` : ''}`,
    exp: () => 'How many years of relevant experience do you have?',
    edu: () => 'What is your highest qualification?',
    work: () => 'Are you currently working? If so, what is your notice period?',
    sal: () => 'What is your current salary, and what do you expect?',
    doubt: () => 'Do you have any doubts about this job?',
    objLoc: () => 'Understood. Are you open to relocating for the right opportunity?',
    objExp: () => 'No problem, I have noted that. I will check for a role closer to your level and get back to you.',
    objJob: () => 'Totally understandable. Think of it as just exploring an option. There is no cost to sending your resume and hearing them out, and if it is not the right fit after the interview, you simply stay where you are. Would you like to explore?',
    objTrust: (f) => `Fair question. This is a confirmed opening${f.company ? ` with ${f.company}` : ''}${f.location ? ` in ${f.location}` : ''}. I can share the role details on WhatsApp so you can verify. Shall we continue?`,
    cbq: () => 'No problem. When would be a better time to call you back?',
    cbok: () => 'Okay, I will call you then. Thank you.',
    near: (f) => `That is good, ${f.location} is close to you.`,
    salaryPitch: (f) => `I understand.${f.persuasion ? ` ${cap(f.persuasion)}.` : ''} The salary can be discussed in the interview, and if you do well in the interview there is a chance of an increase. Would you like to attend the interview?`,
    next: (f) => `Great. ${f.next ? `${cap(f.next)}.` : `${f.contact ? `I can have ${f.contact} call you to explain the next steps, or you` : 'You'} can share your updated resume on WhatsApp.`} What would be a good time for a call?`,
    c1: () => 'May I know what the problem is? If something about the job is a concern, please tell me.',
    c2: () => 'If the location or the salary is a concern, I can note it for our team. What would you prefer?',
    decline: () => 'No problem. Thank you for your time. If you know anyone who is looking for a job, please share this opportunity with them. Have a great day.',
    close: (f) => `Thank you, {name}.${f.contact ? ` For any queries, please contact ${f.contact}.` : ''} Have a nice day.`,
  },
  Telugu: {
    open: (f) => `నమస్కారం {name} గారు, శుభోదయం. నేను ${f.company || 'మా సంస్థ'} నుండి మాట్లాడుతున్న ఆటోమేటెడ్ AI అసిస్టెంట్‌ని.`,
    perm: () => 'మీకు ఒక నిమిషం మాట్లాడే సమయం ఉందా? ఒక ఉద్యోగ అవకాశం గురించి చెప్పాలి.',
    say: (f) => `${f.role} ఓపెనింగ్ ఉంది.${f.location ? ` లొకేషన్ ${f.location}.` : ''}${f.salary ? ` సాలరీ ${f.salary}.` : ''}${f.qualification ? ` క్వాలిఫికేషన్ ${f.qualification}.` : ''}${f.experience ? ` ఎక్స్‌పీరియన్స్ ${f.experience}.` : ''}${f.details ? ` జాబ్ రోల్: ${f.details}.` : ''}${f.benefits ? ` బెనిఫిట్స్: ${f.benefits}.` : ''}`,
    interest: () => 'ఈ ఆపర్చునిటీ మీకు ఇంట్రెస్ట్‌గా ఉందా?',
    loc: (f) => `మీరు ప్రస్తుతం ఎక్కడ ఉంటున్నారు?${f.location ? ` ${f.location} లో వర్క్ చేయడానికి ఓకేనా?` : ''}`,
    exp: () => 'మీకు ఎన్ని ఇయర్స్ రిలీవెంట్ ఎక్స్‌పీరియన్స్ ఉంది?',
    edu: () => 'మీ క్వాలిఫికేషన్ ఏమిటి?',
    work: () => 'మీరు ప్రస్తుతం ఏదైనా జాబ్ చేస్తున్నారా? అయితే మీ నోటీస్ పీరియడ్ ఎంత?',
    sal: () => 'మీ కరెంట్ సాలరీ ఎంత, ఎక్స్‌పెక్టెడ్ సాలరీ ఎంత?',
    doubt: () => 'ఈ జాబ్ గురించి మీకు ఏవైనా డౌట్స్ ఉన్నాయా?',
    objLoc: () => 'అర్థమైంది అండి. సరైన ఆపర్చునిటీ అయితే రీలొకేట్ అవ్వడానికి మీరు రెడీనా?',
    objExp: () => 'పర్వాలేదు అండి, నోట్ చేసుకున్నాను. మీ లెవెల్‌కి సరిపోయే రోల్ ఏదైనా ఉంటే మిమ్మల్ని సంప్రదిస్తాను.',
    objJob: () => 'అర్థమైంది అండి. ఇది ఒక ఆప్షన్ ఎక్స్‌ప్లోర్ చేయడం లాంటిదే. రెజ్యూమ్ పంపడానికి ఖర్చేమీ లేదు, ఇంటర్వ్యూలో సరిపోకపోతే మీరు ఇప్పుడున్న చోటే ఉంటారు. ఎక్స్‌ప్లోర్ చేస్తారా?',
    objTrust: (f) => `మంచి ప్రశ్న అండి. ఇది${f.company ? ` ${f.company} లో` : ''}${f.location ? ` ${f.location} లో` : ''} కన్ఫర్మ్డ్ ఓపెనింగ్. వెరిఫై చేసుకోవడానికి డీటెయిల్స్ వాట్సాప్‌లో పంపుతాను. కొనసాగించమంటారా?`,
    cbq: () => 'పర్వాలేదు అండి. మళ్ళీ ఎప్పుడు కాల్ చేస్తే మీకు కన్వీనియంట్?',
    cbok: () => 'సరే అండి, ఆ టైమ్‌కి కాల్ చేస్తాను. ధన్యవాదాలు.',
    near: (f) => `చాలా మంచిది, ${f.location} మీకు క్లోజ్‌గానే ఉంది.`,
    salaryPitch: (f) => `అర్థమైంది అండి.${f.persuasion ? ` ${f.persuasion}.` : ''} సాలరీ గురించి ఇంటర్వ్యూలో మాట్లాడవచ్చు, ఇంటర్వ్యూలో బాగా చేస్తే సాలరీ పెరిగే ఛాన్స్ ఉంది. ఇంటర్వ్యూకి రావడానికి మీకు ఇష్టమేనా?`,
    next: (f) => `చాలా బాగుంది. ${f.contact ? `${f.contact} గారు కాల్ చేసి డీటెయిల్స్ చెప్తారు, లేదా మీరు` : 'మీరు'} మీ రెజ్యూమ్ వాట్సాప్‌లో పంపవచ్చు. మీకు ఏ టైమ్ కన్వీనియంట్‌గా ఉంటుంది?`,
    c1: () => 'మీకు ఏమి ప్రాబ్లమ్ ఉందో చెప్పగలరా? ఏదైనా ఇబ్బంది ఉంటే చెప్పండి.',
    c2: () => 'లొకేషన్ లేదా సాలరీ గురించి ఏదైనా ప్రాబ్లమ్ ఉంటే మా టీమ్‌కి తెలియజేస్తాను. మీకు ఏది ఇష్టం?',
    decline: () => 'సరే అండి, పర్వాలేదు. మీ సమయానికి ధన్యవాదాలు. మీకు తెలిసిన ఎవరైనా ఉద్యోగం కోసం చూస్తుంటే ఈ అవకాశం వారికి చెప్పండి. మంచి రోజు!',
    close: (f) => `ధన్యవాదాలు {name} గారు.${f.contact ? ` ఏవైనా సందేహాలు ఉంటే ${f.contact} గారిని సంప్రదించండి.` : ''} శుభదినం.`,
  },
  Hindi: {
    open: (f) => `नमस्ते {name} जी, शुभ प्रभात। मैं ${f.company || 'हमारी कंपनी'} की ओर से बोल रहा ऑटोमेटेड AI असिस्टेंट हूँ।`,
    perm: () => 'क्या आपके पास एक मिनट बात करने का समय है? एक नौकरी के अवसर के बारे में बताना है।',
    say: (f) => `${f.role} की ओपनिंग है।${f.location ? ` लोकेशन ${f.location}।` : ''}${f.salary ? ` सैलरी ${f.salary}।` : ''}${f.qualification ? ` क्वालिफिकेशन ${f.qualification}।` : ''}${f.experience ? ` एक्सपीरियंस ${f.experience}।` : ''}${f.details ? ` जॉब रोल: ${f.details}।` : ''}${f.benefits ? ` बेनिफिट्स: ${f.benefits}।` : ''}`,
    interest: () => 'क्या आप इस ऑपॉर्च्युनिटी में इंटरेस्टेड हैं?',
    loc: (f) => `आप अभी कहाँ रहते हैं?${f.location ? ` क्या आप ${f.location} में काम करने के लिए ठीक हैं?` : ''}`,
    exp: () => 'आपके पास कितने साल का रिलेवेंट एक्सपीरियंस है?',
    edu: () => 'आपकी क्वालिफिकेशन क्या है?',
    work: () => 'क्या आप अभी कोई जॉब कर रहे हैं? अगर हाँ, तो आपका नोटिस पीरियड क्या है?',
    sal: () => 'आपकी करंट सैलरी कितनी है और एक्सपेक्टेड सैलरी कितनी?',
    doubt: () => 'क्या इस जॉब के बारे में आपका कोई डाउट है?',
    objLoc: () => 'समझ गया। सही ऑपॉर्च्युनिटी हो तो क्या आप रीलोकेट होने के लिए तैयार हैं?',
    objExp: () => 'कोई बात नहीं, मैंने नोट कर लिया। आपके लेवल का कोई रोल होगा तो मैं आपसे संपर्क करूँगा।',
    objJob: () => 'समझ गया। इसे बस एक ऑप्शन एक्सप्लोर करने की तरह देखिए। रिज्यूमे भेजने में कोई खर्च नहीं, और इंटरव्यू में सही न लगे तो आप वहीं रहेंगे जहाँ हैं। क्या एक्सप्लोर करेंगे?',
    objTrust: (f) => `अच्छा सवाल है। यह${f.company ? ` ${f.company} में` : ''}${f.location ? ` ${f.location} की` : ''} कन्फर्म्ड ओपनिंग है। वेरिफाई करने के लिए डिटेल्स व्हाट्सएप पर भेज दूँगा। आगे बढ़ें?`,
    cbq: () => 'कोई बात नहीं। आपको किस टाइम पर दोबारा कॉल करना ठीक रहेगा?',
    cbok: () => 'ठीक है, मैं उस टाइम पर कॉल करूँगा। धन्यवाद।',
    near: (f) => `बहुत अच्छा, ${f.location} आपके क्लोज़ ही है।`,
    salaryPitch: (f) => `समझ गया।${f.persuasion ? ` ${f.persuasion}.` : ''} सैलरी पर इंटरव्यू में बात हो सकती है, और इंटरव्यू अच्छा जाए तो सैलरी बढ़ने का चांस है। क्या आप इंटरव्यू के लिए आना चाहेंगे?`,
    next: (f) => `बहुत अच्छा। ${f.contact ? `${f.contact} जी आपको कॉल करके अगले कदम बता सकते हैं, या आप` : 'आप'} अपना रिज्यूमे व्हाट्सएप पर भेज सकते हैं। आपके लिए कौन सा समय ठीक रहेगा?`,
    c1: () => 'क्या आप बता सकते हैं कि क्या प्रॉब्लम है? कोई चिंता हो तो बताइए।',
    c2: () => 'अगर लोकेशन या सैलरी को लेकर कोई प्रॉब्लम है तो मैं अपनी टीम को बता दूँगा। आप क्या चाहते हैं?',
    decline: () => 'ठीक है, कोई बात नहीं। आपके समय के लिए धन्यवाद। अगर आपका कोई जानकार नौकरी की तलाश में है तो उन्हें यह अवसर बताइए। आपका दिन शुभ हो।',
    close: (f) => `धन्यवाद {name} जी।${f.contact ? ` किसी भी सवाल के लिए ${f.contact} से संपर्क करें।` : ''} शुभ दिन।`,
  },
};
function cap(s) { const t = String(s).trim(); return t ? t[0].toUpperCase() + t.slice(1) : t; }

// "10K" is said "10 thousand" (a voice reads the letter K otherwise)
const THOUSAND = { English: 'thousand', Telugu: 'వేలు', Hindi: 'हज़ार' };
const sayable = (facts, lang) => Object.fromEntries(Object.entries(facts).map(([k, v]) => [k, String(v).replace(/(\d+(?:\.\d+)?)\s*k\b/gi, `$1 ${THOUSAND[lang]}`)]));

/** The call, as script text, in each language. */
function build(factsIn) {
  const out = {};
  Object.entries(L).forEach(([lang, t]) => {
    const facts = sayable(factsIn, lang);
    out[lang] = [
      `Opening: ${t.open(facts)}`, `Ask: ${t.perm(facts)}`, `Say: ${t.say(facts)}`, `Interest: ${t.interest(facts)}`, `Ask: ${t.loc(facts)}`, `Ask: ${t.exp(facts)}`, `Ask: ${t.edu(facts)}`, `Ask: ${t.work(facts)}`, `Ask: ${t.sal(facts)}`, `Ask: ${t.doubt(facts)}`, `Ask: ${t.next(facts)}`,
      `Convince: ${t.c1(facts)}`, `Convince: ${t.c2(facts)}`, `Decline: ${t.decline(facts)}`, `Closing: ${t.close(facts)}`,
    ].join('\n');
  });
  return out;
}

const startLanguage = (facts) => { const l = String(facts.language || '').toLowerCase(); return l.startsWith('tel') ? 'Telugu' : (l.startsWith('hin') ? 'Hindi' : 'English'); };

// a person's question, answered from the facts only (nothing is invented): null when the facts do not answer it
const Q = {
  salary: /salary|pay\b|package|ctc|money|how much|జీతం|శాలరి|సాలరి|సాలరీ|శాలరీ|జీతమెంత|ఎంత|वेतन|सैलरी|तनख्वाह|कितना/i,
  location: /where|location|place|city|area|office|ఎక్కడ|స్థలం|లొకేషన్|లోకేషన్|లొకేషనా|कहाँ|कहां|स्थान|लोकेशन|जगह/i,
  qualification: /qualification|degree|graduate|education|eligib|అర్హత|క్వాలిఫికేషన్|योग्यता|क्वालिफिकेशन|पात्र/i,
  role: /what (is|kind|work)|role|work|job|duties|responsibilit|ఏ ఉద్యోగం|పని|రోల్|జాబ్|क्या काम|काम|रोल|जॉब/i,
  experience: /experience|fresher|అనుభవం|अनुभव/i,
};
const A = {
  English: { salary: (f) => `The salary is ${f.salary}.`, location: (f) => `The location is ${f.location}.`, qualification: (f) => `The qualification needed is ${f.qualification}.`, role: (f) => `The role is ${f.role}${f.details ? `: ${f.details}` : ''}.`, experience: (f) => `Experience: ${f.experience}.` },
  Telugu: { salary: (f) => `సాలరీ ${f.salary}.`, location: (f) => `లొకేషన్ ${f.location}.`, qualification: (f) => `క్వాలిఫికేషన్ ${f.qualification}.`, role: (f) => `జాబ్ ${f.role}${f.details ? `: ${f.details}` : ''}.`, experience: (f) => `ఎక్స్‌పీరియన్స్ ${f.experience}.` },
  Hindi: { salary: (f) => `सैलरी ${f.salary}।`, location: (f) => `लोकेशन ${f.location}।`, qualification: (f) => `क्वालिफिकेशन ${f.qualification}।`, role: (f) => `जॉब ${f.role}${f.details ? `: ${f.details}` : ''}।`, experience: (f) => `एक्सपीरियंस ${f.experience}।` },
};
// strict: only the pay / place / qualification / experience words count (the plain words of "role" - work, job - are in too many replies)
function answer(factsIn, text, lang, strict = false) {
  if (!factsIn) return null;
  const facts = sayable(factsIn, lang);
  const a = A[lang] || A.English;
  const hit = ['salary', 'location', 'qualification', 'experience', 'role'].filter((k) => !(strict && k === 'role')).find((k) => Q[k].test(String(text || '')) && facts[k]);
  return hit ? a[hit](facts) : null;
}

// the question "where are you located?" (in any of the three languages), whether an answer says the job is near, and what is said then
const LOC_START = ['Where are you currently located', 'మీరు ప్రస్తుతం ఎక్కడ ఉంటున్నారు', 'आप अभी कहाँ रहते हैं'];
const isLocQuestion = (text) => LOC_START.some((p) => String(text || '').trim().startsWith(p));
function near(facts, text) {
  const loc = String((facts && facts.location) || '').toLowerCase();
  const t = String(text || '').toLowerCase();
  if (!loc) return false;
  const SS = require('./voice/speakScript'); // eslint-disable-line global-require
  return t.includes(loc) || t.includes(SS.native(facts.location, 'Telugu')) || t.includes(SS.native(facts.location, 'Hindi')) || /\b(near|nearby|close|around)\b|దగ్గర|పక్క|पास|नज़दीक|नजदीक/.test(t);
}
const nearAck = (facts, lang) => (L[lang] || L.English).near(sayable(facts, lang));
// pay is the problem ("salary is low"): what can be said (founder 2026-11-05: salary can be talked about in the interview, a chance of an increase if it goes well)
const SALARY_WORDS = /salary|pay\b|package|ctc|జీతం|శాలరి|సాలరి|సాలరీ|శాలరీ|वेतन|सैलरी|तनख्वाह/i;
const salaryReason = (text) => SALARY_WORDS.test(String(text || ''));
const salaryPitch = (facts, lang) => (L[lang] || L.English).salaryPitch(sayable(facts, lang));

// WHAT THE PERSON SAID IS AN OBJECTION: the line that answers it (once each); "experience" closes the call kindly, the others ask again
const OBJ = [
  ['location', /\b(far|distance|too far|long way|travel|commute)\b|దూరం|దూరంగా|ట్రావెల్|दूर|डिस्टेंस/i],
  ['experience', /\b(experience|fresher|not enough)\b|అనుభవం|ఎక్స్‌పీరియన్స్|अनुभव|एक्सपीरियंस/i],
  ['employed', /(already|currently)\s*(working|employed)|have a job|not looking|ఇప్పటికే|ఆల్రెడీ|పనిచేస్తున్నా|जॉब कर रहा|नौकरी कर|पहले से/i],
  ['trust', /\b(real|genuine|fake|true|scam)\b|నిజమా|ఫేక్|असली|सच|फेक/i],
  ['salary', SALARY_WORDS],
];
const OBJ_LINE = { location: 'objLoc', experience: 'objExp', employed: 'objJob', trust: 'objTrust' };
function objection(facts, text, lang, used = []) {
  const t = String(text || '');
  const hit = OBJ.find(([k, re]) => !used.includes(k) && re.test(t));
  if (!hit) return null;
  const key = hit[0];
  const f = sayable(facts, lang);
  const say = key === 'salary' ? salaryPitch(facts, lang) : (L[lang] || L.English)[OBJ_LINE[key]](f);
  return { key, say, end: key === 'experience' };
}
const callbackQuestion = (lang) => (L[lang] || L.English).cbq();
const callbackOk = (lang) => (L[lang] || L.English).cbok();

module.exports = { objection, callbackQuestion, callbackOk, parseFacts, build, startLanguage, answer, isLocQuestion, near, nearAck, salaryReason, salaryPitch, KEYS };
