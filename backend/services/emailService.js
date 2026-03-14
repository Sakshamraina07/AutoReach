/**
 * Replaces template variables with actual data.
 * Supported: {name}, {company}, {role}, {year}, {degree}, {location}, {user_name}, {contact}
 */
export const compileTemplate = (templateString, recruiterData = {}, userData = {}) => {
    if (!templateString) return '';

    const replaceMap = {
        '{name}': recruiterData.hr_name || '',
        '{company}': recruiterData.company || '',
        '{role}': recruiterData.role || '',
        '{year}': userData.year || '',
        '{degree}': userData.degree || '',
        '{location}': userData.location || '',
        '{user_name}': userData.name || '',
        '{contact}': userData.contact || ''
    };

    let compiled = templateString;
    for (const [key, value] of Object.entries(replaceMap)) {
        // Global case-insensitive replacement
        const regex = new RegExp(key, 'gi');
        compiled = compiled.replace(regex, value);
    }

    return compiled;
};

/**
 * Returns a random delay in milliseconds between min and max (inclusive)
 */
export const getRandomDelay = (minSeconds = 30, maxSeconds = 90) => {
    const min = Math.ceil(minSeconds * 1000);
    const max = Math.floor(maxSeconds * 1000);
    return Math.floor(Math.random() * (max - min + 1) + min);
};

/**
 * Calculates email warmup limits based on account age.
 */
export const getWarmupLimit = (userCreatedAt) => {
    if (!userCreatedAt) return 5;
    const now = new Date();
    const created = new Date(userCreatedAt);
    const diffDays = Math.floor((now - created) / (1000 * 60 * 60 * 24));

    if (diffDays === 0) return 5; // Day 1
    if (diffDays === 1) return 10; // Day 2
    return 25; // Day 3+
};