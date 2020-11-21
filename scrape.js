const configResult = require('dotenv').config()
const axios = require('axios');
const puppeteer = require('puppeteer');
const wishlistUrl = 'https://wishlist.webflow.com/';
const recentUrlQuery = '?sort=recent';

// Check if a config is defined, otherwise the scraping is useless
if (configResult.error || !configResult.parsed.PUSH_URL) {
    throw new Error("You must define a value for PUSH_URL in your .env file.");
}


(async () => {
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ DNT: "1" });
    await page.setViewport({ width: 1920, height: 1080 });
    await page.goto(wishlistUrl, { waitUntil: "networkidle2", timeout: 15000 });

    try {
        const ideasByStatuses = await getAllIdeasByStatus(page);
        const recentIdeas = await getRecentIdeas(page);
        const pushResponse = await pushResults({
            ideasByStatuses,
            recentIdeas,
        });
        console.log('Pushed results to provided endpoint. Response from the endpoint is provided below...');
        console.log(`${pushResponse.status} (${pushResponse.statusText}) : ${pushResponse.data}`);
    } catch (error) {
        console.error(error);
    } finally {
        await browser.close();
    }
})();

function pushResults(data) {
    return axios.post(configResult.parsed.PUSH_URL, data);
}

async function getStatuses(page) {
    return page.evaluate(() => {
        const statuses = [];
        for (const filterLink of document.querySelectorAll('ul.statuses.filters a')) {
            statuses.push({
                name: filterLink.textContent.trim(),
                id: filterLink.getAttribute('data-url-param-toggle-value'),
                url: filterLink.href,
            });
        }
        return statuses;
    });
}

async function getRecentIdeas(page) {
    await page.goto(wishlistUrl + recentUrlQuery, { waitUntil: "networkidle2", timeout: 15000 });
    return await getPageIdeas(page);
}

async function getAllIdeasByStatus(page) {
    const statuses = await getStatuses(page);

    for (const status of statuses) {
        await delay(1500); // No need to be rude to Webflow's servers...
        await page.goto(status.url, { waitUntil: "networkidle2", timeout: 15000 });
        status.ideas = await getAllPaginatedIdeas(page);
    }

    return statuses;
}

async function getAllPaginatedIdeas(page) {
    let ideas = [];

    do {
        ideas = ideas.concat(await getPageIdeas(page));
    } while (await goToNextPage(page));

    return ideas;
}

async function goToNextPage(page) {
    const nextPageUrl = await page.evaluate(() => {
        const nextLink = document.querySelector('.portal-content .pagination a[rel="next"]');
        return nextLink ? nextLink.href : null;
    });

    if (!nextPageUrl) {
        return false;
    }

    await delay(1500); // No need to be rude to Webflow's servers...
    await page.goto(nextPageUrl, { waitUntil: "networkidle2", timeout: 15000 });
    return true;
}

async function getPageIdeas(page) {
    return page.evaluate(() => {
        const ideas = [];
        for (const ideaNode of document.querySelectorAll('.portal-content ul.list-ideas > li.idea')) {
            const metaLine1 = ideaNode.querySelector('.idea-meta-created .idea-meta-secondary:first-child').textContent.trim();
            const statusNode = ideaNode.querySelector('.status-pill');

            ideas.push({
                name: ideaNode.querySelector('h3').textContent.trim(),
                preview: ideaNode.querySelector('.description').textContent.trim(),
                userImage: ideaNode.querySelector('.avatar img').src,
                userName: metaLine1.replace(/^.+by (.+)\s*$/s, '$1').trim(),
                date: metaLine1.replace(/^Created (.+) by.+\w*$/s, '$1').trim(),
                category: ideaNode.querySelector('.idea-meta-created .idea-meta-secondary:last-child').textContent.trim(),
                voteCount: ideaNode.querySelector('.vote-count').textContent.trim(),
                commentCount: ideaNode.querySelector('.comment-count').textContent.trim(),
                status: statusNode ? statusNode.textContent.trim() : null,
                url: ideaNode.querySelector('.idea-link').href,
            });
        }
        return ideas;
    });
}

async function getStatuses(page) {
    return page.evaluate(() => {
        const statuses = [];
        for (const filterLink of document.querySelectorAll('ul.statuses.filters a')) {
            statuses.push({
                name: filterLink.textContent.trim(),
                id: filterLink.getAttribute('data-url-param-toggle-value'),
                url: filterLink.href,
            });
        }
        return statuses;
    });
}

async function handleInitialLogin() {
    status = 'handleInitialLogin';
    verbose('Starting the login process.');

    // If a connection has been established previously, there might already be a card on file - check to log in with it
    if (await page.$('.carte-memorisee a[role="button"]')) {
        verbose('A memorized card is suggested - selecting it.');

        return await Promise.all([
            page.click('.carte-memorisee a[role="button"]'),
            page.waitForSelector('#champsReponse, input[name="motDePasse"]', { timeout: 30000 }),
        ]);
    } else {
        verbose('The user\'s code is requested: entering it.');

        let userCodeInput = await page.$('input[name="codeUtilisateur"]');

        if (!userCodeInput) {
            await endWithError('No user code input on this interface.');
        }

        await userCodeInput.type(accountInfo.authentication.userCode, { delay: 50 });
        return await Promise.all([
            userCodeInput.press('Enter'),
            page.waitForSelector('#champsReponse, input[name="motDePasse"]', { timeout: 30000 }),
        ]);
    }
}

async function handleSecurityQuestion() {
    status = 'handleSecurityQuestion';

    let securityQuestionWrapper = await page.$('#champsReponse');
    if (securityQuestionWrapper) {
        verbose('The answer to security question is requested.');

        let questionWrapper = await page.$('label[for="valeurReponse"]');
        let question = (await (await (await questionWrapper.$('b')).getProperty('textContent')).jsonValue()).trim();
        let answerInput = await page.$('input[name="valeurReponse"]');
        let answer = null;

        if (question in accountInfo.authentication.securityQuestions) {
            answer = accountInfo.authentication.securityQuestions[question];
        }

        if (!answer) {
            await endWithError('Unknown security question: ' + question);
        }

        verbose('Ah, this is an easy one! I got this...');
        await answerInput.type(answer, { delay: 50 });

        return await Promise.all([
            answerInput.press('Enter'),
            page.waitForSelector('input[name="motDePasse"]', { timeout: 30000 }),
        ]);
    }

    return;
}

function delay(time) {
   return new Promise(function(resolve) {
       setTimeout(resolve, time)
   });
}
