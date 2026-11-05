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
  benefits: 'benefits|perks', contact: 'contact|recruiter|manager|contact person', next: 'next|next step', language: 'language|start language',
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
    say: (f) => `We have an opening for ${f.role}.${f.location ? ` The location is ${f.location}.` : ''}${f.salary ? ` The salary is ${f.salary}.` : ''}${f.qualification ? ` The qualification needed is ${f.qualification}.` : ''}${f.experience ? ` Experience: ${f.experience}.` : ''}${f.details ? ` The work is ${f.details}.` : ''}${f.benefits ? ` Benefits: ${f.benefits}.` : ''}`,
    interest: () => 'Are you interested in this opportunity?',
    next: (f) => `Great. ${f.next ? `${cap(f.next)}.` : `${f.contact ? `I can have ${f.contact} call you to explain the next steps, or you` : 'You'} can share your updated resume on WhatsApp.`} What would be a good time for a call?`,
    c1: (f) => `It is a good opportunity: ${f.role}${f.location ? ` in ${f.location}` : ''}${f.salary ? `, ${f.salary}` : ''}. It will only take a minute. Shall I tell you a little more?`,
    c2: () => 'If the location or the salary is a concern, I can note it for our team. What would you prefer?',
    decline: () => 'No problem. Thank you for your time. If you know anyone who is looking for a job, please share this opportunity with them. Have a great day.',
    close: (f) => `Thank you, {name}.${f.contact ? ` For any queries, please contact ${f.contact}.` : ''} Have a nice day.`,
  },
  Telugu: {
    open: (f) => `నమస్కారం {name} గారు, శుభోదయం. నేను ${f.company || 'మా సంస్థ'} నుండి మాట్లాడుతున్న ఆటోమేటెడ్ AI అసిస్టెంట్‌ని.`,
    perm: () => 'మీకు ఒక నిమిషం మాట్లాడే సమయం ఉందా? ఒక ఉద్యోగ అవకాశం గురించి చెప్పాలి.',
    say: (f) => `${f.role} పోస్టు ఖాళీగా ఉంది.${f.location ? ` స్థలం ${f.location}.` : ''}${f.salary ? ` జీతం ${f.salary}.` : ''}${f.qualification ? ` అర్హత ${f.qualification}.` : ''}${f.experience ? ` అనుభవం ${f.experience}.` : ''}${f.details ? ` పని: ${f.details}.` : ''}${f.benefits ? ` ప్రయోజనాలు: ${f.benefits}.` : ''}`,
    interest: () => 'ఈ అవకాశం మీకు ఆసక్తిగా ఉందా?',
    next: (f) => `చాలా బాగుంది. ${f.contact ? `${f.contact} గారు కాల్ చేసి వివరాలు చెప్తారు, లేదా మీరు` : 'మీరు'} మీ రెజ్యూమ్ వాట్సాప్‌లో పంపవచ్చు. మీకు ఏ సమయం అనుకూలంగా ఉంటుంది?`,
    c1: (f) => `ఇది మంచి అవకాశం అండి. ${f.role}${f.location ? `, ${f.location}` : ''}${f.salary ? `, జీతం ${f.salary}` : ''}. ఒక్క నిమిషం చాలు. మరికొంత చెప్పమంటారా?`,
    c2: () => 'స్థలం లేదా జీతం గురించి ఏదైనా సమస్య ఉంటే మా టీమ్‌కి తెలియజేస్తాను. మీకు ఏది ఇష్టం?',
    decline: () => 'సరే అండి, పర్వాలేదు. మీ సమయానికి ధన్యవాదాలు. మీకు తెలిసిన ఎవరైనా ఉద్యోగం కోసం చూస్తుంటే ఈ అవకాశం వారికి చెప్పండి. మంచి రోజు!',
    close: (f) => `ధన్యవాదాలు {name} గారు.${f.contact ? ` ఏవైనా సందేహాలు ఉంటే ${f.contact} గారిని సంప్రదించండి.` : ''} శుభదినం.`,
  },
  Hindi: {
    open: (f) => `नमस्ते {name} जी, शुभ प्रभात। मैं ${f.company || 'हमारी कंपनी'} की ओर से बोल रहा ऑटोमेटेड AI असिस्टेंट हूँ।`,
    perm: () => 'क्या आपके पास एक मिनट बात करने का समय है? एक नौकरी के अवसर के बारे में बताना है।',
    say: (f) => `${f.role} का पद खाली है।${f.location ? ` स्थान ${f.location}।` : ''}${f.salary ? ` वेतन ${f.salary}।` : ''}${f.qualification ? ` योग्यता ${f.qualification}।` : ''}${f.experience ? ` अनुभव ${f.experience}।` : ''}${f.details ? ` काम: ${f.details}।` : ''}${f.benefits ? ` लाभ: ${f.benefits}।` : ''}`,
    interest: () => 'क्या आप इस अवसर में रुचि रखते हैं?',
    next: (f) => `बहुत अच्छा। ${f.contact ? `${f.contact} जी आपको कॉल करके अगले कदम बता सकते हैं, या आप` : 'आप'} अपना रिज्यूमे व्हाट्सएप पर भेज सकते हैं। आपके लिए कौन सा समय ठीक रहेगा?`,
    c1: (f) => `यह अच्छा अवसर है। ${f.role}${f.location ? `, ${f.location}` : ''}${f.salary ? `, वेतन ${f.salary}` : ''}। बस एक मिनट लगेगा। क्या मैं थोड़ा और बताऊँ?`,
    c2: () => 'अगर स्थान या वेतन को लेकर कोई चिंता है तो मैं अपनी टीम को बता दूँगा। आप क्या चाहते हैं?',
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
      `Opening: ${t.open(facts)}`, `Ask: ${t.perm(facts)}`, `Say: ${t.say(facts)}`, `Interest: ${t.interest(facts)}`, `Ask: ${t.next(facts)}`,
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
  Telugu: { salary: (f) => `జీతం ${f.salary}.`, location: (f) => `స్థలం ${f.location}.`, qualification: (f) => `అర్హత ${f.qualification}.`, role: (f) => `పోస్టు ${f.role}${f.details ? `: ${f.details}` : ''}.`, experience: (f) => `అనుభవం ${f.experience}.` },
  Hindi: { salary: (f) => `वेतन ${f.salary}।`, location: (f) => `स्थान ${f.location}।`, qualification: (f) => `योग्यता ${f.qualification}।`, role: (f) => `पद ${f.role}${f.details ? `: ${f.details}` : ''}।`, experience: (f) => `अनुभव ${f.experience}।` },
};
function answer(factsIn, text, lang) {
  if (!factsIn) return null;
  const facts = sayable(factsIn, lang);
  const a = A[lang] || A.English;
  const hit = ['salary', 'location', 'qualification', 'experience', 'role'].find((k) => Q[k].test(String(text || '')) && facts[k]);
  return hit ? a[hit](facts) : null;
}

module.exports = { parseFacts, build, startLanguage, answer, KEYS };
