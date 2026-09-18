const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;

function validateEmail(email) {
  if (!email) return false;
  return emailRegex.test(email);
}

function validateSpamPolicy(row, subject, text, html = '') {
  // Check for missing personalization
  if (!row.ship_name || row.ship_name.trim() === '') {
    return { passed: false, error: "Missing 'ship_name' for personalization." };
  }
  
  // Basic check for spammy subject
  if (subject && subject === subject.toUpperCase() && subject.trim() !== '') {
    return { passed: false, error: "Subject is ALL CAPS, high spam risk." };
  }
  
  // Check for common spam trigger words
  const spamWords = ['100% free', 'urgent', 'winner', 'guarantee', 'click here'];
  const contentLower = (subject + ' ' + text + ' ' + html).toLowerCase();
  
  for (const word of spamWords) {
    if (contentLower.includes(word)) {
      return { passed: false, error: `Content contains spam trigger phrase: "${word}".` };
    }
  }

  // Check content length
  if (text && text.length < 50) {
     return { passed: false, error: "Content is too short, lacks professional details." };
  }

  return { passed: true };
}

module.exports = {
  validateEmail,
  validateSpamPolicy
};
