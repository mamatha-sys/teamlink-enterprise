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
  contact: 'contact|recruiter|manager|contact person', next: 'next|next step', langask: 'language choice|ask language|choose language|language question', language: 'language|start language',
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

// good morning / afternoon / evening by the hour in India (the recruiter's script: "Good [morning/afternoon]")
function dayPart() { const h = new Date(Date.now() + 19800000).getUTCHours(); return h < 12 ? 0 : (h < 17 ? 1 : 2); }
const GREET = { English: ['good morning', 'good afternoon', 'good evening'], Telugu: ['శుభోదయం', 'శుభ మధ్యాహ్నం', 'శుభ సాయంత్రం'], Hindi: ['शुभ प्रभात', 'शुभ दोपहर', 'शुभ संध्या'] };
const greet = (lang) => GREET[lang][dayPart()];

const L = {
  English: {
    open: (f) => `Hello {name}, ${greet('English')}. This is an automated AI assistant calling from ${f.company || 'our company'}${f.contact ? ` on behalf of ${f.contact}` : ''}.`,
    perm: () => 'Do you have one minute to talk about a job opportunity?',
    lang: () => 'Which language are you most comfortable with: English, Telugu or Hindi?',
    sum: (a) => `Let me confirm what I noted. ${a.loc ? `Location, ${a.loc}. ` : ''}${a.exp ? `Experience, ${a.exp}. ` : ''}${a.edu ? `Qualification, ${a.edu}. ` : ''}${a.work ? `Working and notice period, ${a.work}. ` : ''}${a.sal ? `Salary, ${a.sal}. ` : ''}Is that correct?`,
    sumFix: () => 'Okay, I will note the correction for our team.',
    budget: (f) => `I understand, thank you for sharing your expectation. The budget for this role is ${f.salary}. If there is any flexibility after your profile is evaluated, our recruitment team will discuss it with you. Would you still like to proceed?`,
    noticeLong: () => 'Thank you for sharing that. I will note your notice period and discuss it with the hiring team.',
    objFamily: () => 'Certainly, this is an important decision and I understand. I will share the job details on WhatsApp so you can review them with your family, and our team will follow up with you in two days. Thank you.',
    objStudies: () => 'That is wonderful, I wish you success in your studies. I will update our records, and if you look for opportunities in the future we would be happy to help. Have a great day.',
    objWfh: () => 'Understood, I will note your preference for work from home. If a suitable remote opening comes up, we will contact you. Thank you for your time.',
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
    next: (f) => `Great. ${f.next ? `${cap(f.next)}.` : `${f.contact ? `I can have ${f.contact} call you to explain the next steps, or you` : 'You'} can share your updated resume on ${f.channel || 'WhatsApp'}.`} What would be a good time for a call?`,
    c1: () => 'May I know what the problem is? If something about the job is a concern, please tell me.',
    c2: () => 'If the location or the salary is a concern, I can note it for our team. What would you prefer?',
    decline: () => 'No problem. Thank you for your time. If you know anyone who is looking for a job, please share this opportunity with them. Have a great day.',
    close: (f) => `Thank you, {name}.${f.contact ? ` For any queries, please contact ${f.contact}.` : ''} Have a nice day.`,
  },
  Telugu: {
    open: (f) => `నమస్కారం {name} గారు, ${greet('Telugu')}. నేను ${f.company || 'మా సంస్థ'} నుండి మాట్లాడుతున్న ఆటోమేటెడ్ AI అసిస్టెంట్‌ని.`,
    perm: () => 'మీకు ఒక నిమిషం మాట్లాడే సమయం ఉందా? ఒక ఉద్యోగ అవకాశం గురించి చెప్పాలి.',
    lang: () => 'మీకు ఏ లాంగ్వేజ్ కంఫర్టబుల్: ఇంగ్లీష్, తెలుగు లేదా హిందీ?',
    sum: (a) => `నేను నోట్ చేసుకున్నది కన్ఫర్మ్ చేస్తాను. ${a.loc ? `లొకేషన్, ${a.loc}. ` : ''}${a.exp ? `ఎక్స్‌పీరియన్స్, ${a.exp}. ` : ''}${a.edu ? `క్వాలిఫికేషన్, ${a.edu}. ` : ''}${a.work ? `జాబ్ మరియు నోటీస్ పీరియడ్, ${a.work}. ` : ''}${a.sal ? `సాలరీ, ${a.sal}. ` : ''}ఇది కరెక్టేనా?`,
    sumFix: () => 'సరే అండి, ఆ కరెక్షన్ మా టీమ్‌కి తెలియజేస్తాను.',
    budget: (f) => `అర్థమైంది అండి, మీ ఎక్స్‌పెక్టేషన్ చెప్పినందుకు ధన్యవాదాలు. ఈ రోల్‌కి బడ్జెట్ ${f.salary}. మీ ప్రొఫైల్ ఎవాల్యుయేట్ చేసిన తర్వాత ఏదైనా ఫ్లెక్సిబిలిటీ ఉంటే మా రిక్రూట్‌మెంట్ టీమ్ మీతో మాట్లాడుతుంది. అయినా ముందుకు వెళ్లడానికి మీకు ఇష్టమేనా?`,
    noticeLong: () => 'చెప్పినందుకు ధన్యవాదాలు అండి. మీ నోటీస్ పీరియడ్ నోట్ చేసుకుని హైరింగ్ టీమ్‌తో మాట్లాడతాను.',
    objFamily: () => 'తప్పకుండా అండి, ఇది ముఖ్యమైన నిర్ణయం, అర్థమైంది. జాబ్ డీటెయిల్స్ వాట్సాప్‌లో పంపుతాను, మీ ఫ్యామిలీతో చూసుకోండి. రెండు రోజుల్లో మా టీమ్ మిమ్మల్ని సంప్రదిస్తుంది. ధన్యవాదాలు.',
    objStudies: () => 'చాలా బాగుంది అండి, మీ చదువులో విజయం సాధించాలని కోరుకుంటున్నాను. రికార్డ్స్ అప్‌డేట్ చేస్తాను. భవిష్యత్తులో ఉద్యోగం కావాలంటే సహాయం చేయడానికి సిద్ధంగా ఉంటాము. మంచి రోజు!',
    objWfh: () => 'అర్థమైంది అండి, మీ వర్క్ ఫ్రమ్ హోమ్ ప్రాధాన్యతను నోట్ చేసుకుంటాను. తగిన రిమోట్ ఓపెనింగ్ వస్తే మిమ్మల్ని సంప్రదిస్తాము. మీ సమయానికి ధన్యవాదాలు.',
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
    next: (f) => `చాలా బాగుంది. ${f.contact ? `${f.contact} గారు కాల్ చేసి డీటెయిల్స్ చెప్తారు, లేదా మీరు` : 'మీరు'} మీ రెజ్యూమ్ ${f.channel ? `${f.channel} కి` : 'వాట్సాప్‌లో'} పంపవచ్చు. మీకు ఏ టైమ్ కన్వీనియంట్‌గా ఉంటుంది?`,
    c1: () => 'మీకు ఏమి ప్రాబ్లమ్ ఉందో చెప్పగలరా? ఏదైనా ఇబ్బంది ఉంటే చెప్పండి.',
    c2: () => 'లొకేషన్ లేదా సాలరీ గురించి ఏదైనా ప్రాబ్లమ్ ఉంటే మా టీమ్‌కి తెలియజేస్తాను. మీకు ఏది ఇష్టం?',
    decline: () => 'సరే అండి, పర్వాలేదు. మీ సమయానికి ధన్యవాదాలు. మీకు తెలిసిన ఎవరైనా ఉద్యోగం కోసం చూస్తుంటే ఈ అవకాశం వారికి చెప్పండి. మంచి రోజు!',
    close: (f) => `ధన్యవాదాలు {name} గారు.${f.contact ? ` ఏవైనా సందేహాలు ఉంటే ${f.contact} గారిని సంప్రదించండి.` : ''} శుభదినం.`,
  },
  Hindi: {
    open: (f) => `नमस्ते {name} जी, ${greet('Hindi')}। मैं ${f.company || 'हमारी कंपनी'} की ओर से बोल रहा ऑटोमेटेड AI असिस्टेंट हूँ।`,
    perm: () => 'क्या आपके पास एक मिनट बात करने का समय है? एक नौकरी के अवसर के बारे में बताना है।',
    lang: () => 'आप किस भाषा में सहज हैं: इंग्लिश, तेलुगु या हिंदी?',
    sum: (a) => `मैंने जो नोट किया वह कन्फर्म करता हूँ। ${a.loc ? `लोकेशन, ${a.loc}। ` : ''}${a.exp ? `एक्सपीरियंस, ${a.exp}। ` : ''}${a.edu ? `क्वालिफिकेशन, ${a.edu}। ` : ''}${a.work ? `जॉब और नोटिस पीरियड, ${a.work}। ` : ''}${a.sal ? `सैलरी, ${a.sal}। ` : ''}क्या यह सही है?`,
    sumFix: () => 'ठीक है, मैं यह सुधार अपनी टीम को बता दूँगा।',
    budget: (f) => `समझ गया, अपनी उम्मीद बताने के लिए धन्यवाद। इस रोल का बजट ${f.salary} है। प्रोफ़ाइल देखने के बाद अगर कोई फ्लेक्सिबिलिटी हुई तो हमारी रिक्रूटमेंट टीम आपसे बात करेगी। क्या आप फिर भी आगे बढ़ना चाहेंगे?`,
    noticeLong: () => 'बताने के लिए धन्यवाद। मैं आपका नोटिस पीरियड नोट करके हायरिंग टीम से बात करूँगा।',
    objFamily: () => 'ज़रूर, यह एक अहम फैसला है, मैं समझता हूँ। मैं जॉब की डिटेल्स व्हाट्सएप पर भेज दूँगा ताकि आप परिवार के साथ देख सकें, और हमारी टीम दो दिन में आपसे बात करेगी। धन्यवाद।',
    objStudies: () => 'बहुत अच्छा, आपकी पढ़ाई के लिए शुभकामनाएँ। मैं रिकॉर्ड अपडेट कर दूँगा, और आगे कभी नौकरी चाहिए तो हमें मदद करने में खुशी होगी। आपका दिन शुभ हो।',
    objWfh: () => 'समझ गया, मैं आपकी वर्क फ्रॉम होम की पसंद नोट कर लेता हूँ। कोई उपयुक्त रिमोट ओपनिंग आई तो हम आपसे संपर्क करेंगे। आपके समय के लिए धन्यवाद।',
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
    next: (f) => `बहुत अच्छा। ${f.contact ? `${f.contact} जी आपको कॉल करके अगले कदम बता सकते हैं, या आप` : 'आप'} अपना रिज्यूमे ${f.channel ? `${f.channel} पर` : 'व्हाट्सएप पर'} भेज सकते हैं। आपके लिए कौन सा समय ठीक रहेगा?`,
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

const wantsLangAsk = (facts) => /^(y|on|true|1)/i.test(String((facts && facts.langask) || ''));
/** What each step of a vacancy call is, in order (the steps are the same in all three languages). */
const roles = (facts) => ['opening', 'perm', ...(wantsLangAsk(facts) ? ['lang'] : []), 'say', 'interest', 'loc', 'exp', 'edu', 'work', 'sal', 'doubt', 'next'];

/** The call, as script text, in each language. */
function build(factsIn) {
  const out = {};
  Object.entries(L).forEach(([lang, t]) => {
    const facts = sayable(factsIn, lang);
    out[lang] = [
      `Opening: ${t.open(facts)}`, `Ask: ${t.perm(facts)}`, ...(wantsLangAsk(factsIn) ? [`Ask: ${t.lang(facts)}`] : []), `Say: ${t.say(facts)}`, `Interest: ${t.interest(facts)}`, `Ask: ${t.loc(facts)}`, `Ask: ${t.exp(facts)}`, `Ask: ${t.edu(facts)}`, `Ask: ${t.work(facts)}`, `Ask: ${t.sal(facts)}`, `Ask: ${t.doubt(facts)}`, `Ask: ${t.next(facts)}`,
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
  company: /which company|company name|what company|who are you|ఏ కంపెనీ|కంపెనీ పేరు|कौन सी कंपनी|कंपनी का नाम/i,
  benefits: /benefit|insurance|perks|incentive|బెనిఫిట్|बेनिफिट|लाभ/i,
  interview: /\b(online|offline|virtual|video call|walk-?in|interview mode)\b|ఆన్‌లైన్|ఆఫ్‌లైన్|ऑनलाइन|ऑफलाइन/i,
};
const A = {
  English: { salary: (f) => `The salary is ${f.salary}.`, location: (f) => `The location is ${f.location}.`, qualification: (f) => `The qualification needed is ${f.qualification}.`, role: (f) => `The role is ${f.role}${f.details ? `: ${f.details}` : ''}.`, experience: (f) => `Experience: ${f.experience}.`, company: (f) => `This is for ${f.company}.`, benefits: (f) => `Benefits: ${f.benefits}.`, interview: () => 'The interview mode will be decided by the hiring team. It may be online, offline, or in more than one round.' },
  Telugu: { salary: (f) => `సాలరీ ${f.salary}.`, location: (f) => `లొకేషన్ ${f.location}.`, qualification: (f) => `క్వాలిఫికేషన్ ${f.qualification}.`, role: (f) => `జాబ్ ${f.role}${f.details ? `: ${f.details}` : ''}.`, experience: (f) => `ఎక్స్‌పీరియన్స్ ${f.experience}.`, company: (f) => `ఇది ${f.company} కి సంబంధించినది.`, benefits: (f) => `బెనిఫిట్స్: ${f.benefits}.`, interview: () => 'ఇంటర్వ్యూ ఆన్‌లైన్ ఆ ఆఫ్‌లైన్ ఆ అనేది హైరింగ్ టీమ్ నిర్ణయిస్తుంది. ఒకటి కంటే ఎక్కువ రౌండ్లు కూడా ఉండవచ్చు.' },
  Hindi: { salary: (f) => `सैलरी ${f.salary}।`, location: (f) => `लोकेशन ${f.location}।`, qualification: (f) => `क्वालिफिकेशन ${f.qualification}।`, role: (f) => `जॉब ${f.role}${f.details ? `: ${f.details}` : ''}।`, experience: (f) => `एक्सपीरियंस ${f.experience}।`, company: (f) => `यह ${f.company} के लिए है।`, benefits: (f) => `बेनिफिट्स: ${f.benefits}।`, interview: () => 'इंटरव्यू ऑनलाइन होगा या ऑफलाइन, यह हायरिंग टीम तय करेगी। एक से ज़्यादा राउंड भी हो सकते हैं।' },
};
// strict: only the pay / place / qualification / experience words count (the plain words of "role" - work, job - are in too many replies)
function answer(factsIn, text, lang, strict = false) {
  if (!factsIn) return null;
  const facts = sayable(factsIn, lang);
  const a = A[lang] || A.English;
  const hit = ['salary', 'location', 'qualification', 'experience', 'company', 'benefits', 'interview', 'role'].filter((k) => !(strict && k === 'role')).find((k) => Q[k].test(String(text || '')) && (k === 'interview' || facts[k]));
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
  ['family', /(discuss|talk|ask|consult|check)[^.]{0,25}(family|parents|wife|husband|father|mother)|ఇంట్లో[^.]{0,20}(అడగ|మాట్లాడ)|ఫ్యామిలీతో|परिवार[^.]{0,15}(बात|पूछ)|घर वालों/i],
  ['studies', /higher studies|further studies|preparing for|studying for|చదువుకుంటున్న|ఉన్నత విద్య|उच्च शिक्षा|पढ़ाई कर रहा/i],
  ['wfh', /(only|prefer|looking for|want|need)[^.]{0,25}(work[- ]from[- ]home|wfh|remote)|ఇంటి నుండి పని మాత్రమే|घर से काम ही/i],
  ['location', /\b(far|distance|too far|long way|travel|commute)\b|దూరం|దూరంగా|ట్రావెల్|दूर|डिस्टेंस/i],
  ['experience', /\b(experience|fresher|not enough)\b|అనుభవం|ఎక్స్‌పీరియన్స్|अनुभव|एक्सपीरियंस/i],
  ['employed', /(already|currently)\s*(working|employed)|have a job|not looking|ఇప్పటికే|ఆల్రెడీ|పనిచేస్తున్నా|जॉब कर रहा|नौकरी कर|पहले से/i],
  ['trust', /\b(real|genuine|fake|true|scam)\b|నిజమా|ఫేక్|असली|सच|फेक/i],
  ['salary', SALARY_WORDS],
];
const OBJ_LINE = { location: 'objLoc', experience: 'objExp', employed: 'objJob', trust: 'objTrust', family: 'objFamily', studies: 'objStudies', wfh: 'objWfh' };
const OBJ_END = { experience: 'experience does not match', family: 'wants to discuss with family', studies: 'preparing for higher studies', wfh: 'wants work from home' };
function objection(facts, text, lang, used = [], only = null) {
  const t = String(text || '');
  const hit = OBJ.find(([k, re]) => !used.includes(k) && (!only || only.includes(k)) && re.test(t));
  if (!hit) return null;
  const key = hit[0];
  const f = sayable(facts, lang);
  const say = key === 'salary' ? salaryPitch(facts, lang) : (L[lang] || L.English)[OBJ_LINE[key]](f);
  return { key, say, end: !!OBJ_END[key], why: OBJ_END[key] || null };
}
const callbackQuestion = (lang) => (L[lang] || L.English).cbq();
const callbackOk = (lang) => (L[lang] || L.English).cbok();

// "12K", "12,000", "8 LPA", "ten thousand": the money in a sentence, in rupees (null when none); basis 'year' for lakh / LPA words
const WORDNUM = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, fifteen: 15, twenty: 20, twenty5: 25, thirty: 30, forty: 40, fifty: 50 };
function moneyIn(text) {
  const t = String(text || '').toLowerCase().replace(/(\d),(\d{3})/g, '$1$2').replace(/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|fifteen|twenty|thirty|forty|fifty)\b(?=\s*(thousand|lakh|lakhs|lac|k\b))/g, (w) => WORDNUM[w]);
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*(k\b|thousand|lakhs?|lacs?|lpa)?/g;
  let m = re.exec(t);
  while (m) {
    const n = parseFloat(m[1]); const u = m[2] || '';
    const annual = /lakh|lac|lpa/.test(u);
    const v = /^(k|thousand)/.test(u) ? n * 1000 : (annual ? n * 100000 : n);
    if (v >= 1000) out.push({ v, annual: annual || (!u && v >= 200000), at: m.index });
    m = re.exec(t);
  }
  return out;
}
/** true when what the person expects (the last amount said after "expect", else the last amount) is above the budget of the vacancy. */
function overBudget(facts, text) {
  const budget = moneyIn(facts && facts.salary);
  if (!budget.length) return false;
  const b = Math.max(...budget.map((x) => (x.annual ? x.v / 12 : x.v)));
  const t = String(text || '');
  const ex = /expect|ఎక్స్‌పెక్ట|एक्सपेक्ट|उम्मीद/i.exec(t);
  const said = moneyIn(ex ? t.slice(ex.index) : t);
  if (!said.length) return false;
  const last = said[said.length - 1];
  return (last.annual ? last.v / 12 : last.v) > b * 1.001;
}
/** the notice period in the sentence is long (60 days or more) */
function noticeLong(text) {
  const t = String(text || '').toLowerCase();
  const m = /(\d+)\s*(day|days|month|months|నెల|నెలలు|दिन|महीने|महीना)/.exec(t) || /\b(one|two|three)\s*(month|months)\b/.exec(t);
  if (!m) return false;
  const n = WORDNUM[m[1]] || parseFloat(m[1]);
  return /month|నెల|महीन/.test(m[2]) ? n * 30 >= 60 : n >= 60;
}
const budgetLine = (facts, lang) => (L[lang] || L.English).budget(sayable(facts, lang));
const noticeLine = (lang) => (L[lang] || L.English).noticeLong();
const languageQuestion = (lang) => (L[lang] || L.English).lang();
const summaryLine = (ans, lang) => (L[lang] || L.English).sum(ans);
const summaryFix = (lang) => (L[lang] || L.English).sumFix();
/** the language a person chose (null when none is named); "Telugu and English" is Telugu, "Hindi + English" is Hindi */
function chosenLanguage(text) {
  const t = String(text || '');
  if (/telugu|తెలుగు|तेलुगु|तेलुगू/i.test(t)) return 'Telugu';
  if (/hindi|హిందీ|हिंदी|हिन्दी/i.test(t)) return 'Hindi';
  if (/english|ఇంగ్లీష్|इंग्लिश|अंग्रेज़ी|अंग्रेजी/i.test(t)) return 'English';
  return null;
}

module.exports = { roles, overBudget, noticeLong, budgetLine, noticeLine, languageQuestion, summaryLine, summaryFix, chosenLanguage, moneyIn, objection, callbackQuestion, callbackOk, parseFacts, build, startLanguage, answer, isLocQuestion, near, nearAck, salaryReason, salaryPitch, KEYS };
