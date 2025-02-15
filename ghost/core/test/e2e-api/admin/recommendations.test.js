const {agentProvider, fixtureManager, mockManager, matchers} = require('../../utils/e2e-framework');
const {anyObjectId, anyErrorId, anyISODateTime, anyContentVersion, anyLocationFor, anyEtag} = matchers;
const assert = require('assert/strict');
const recommendationsService = require('../../../core/server/services/recommendations');
const {Recommendation, ClickEvent, SubscribeEvent} = require('@tryghost/recommendations');

async function addDummyRecommendation(i = 0) {
    const recommendation = Recommendation.create({
        title: `Recommendation ${i}`,
        reason: `Reason ${i}`,
        url: new URL(`https://recommendation${i}.com`),
        favicon: new URL(`https://recommendation${i}.com/favicon.ico`),
        featuredImage: new URL(`https://recommendation${i}.com/featured.jpg`),
        excerpt: 'Test excerpt',
        oneClickSubscribe: true,
        createdAt: new Date(i * 5000) // Reliable ordering
    });

    await recommendationsService.repository.save(recommendation);
    return recommendation.id;
}

async function addDummyRecommendations(amount = 15) {
    // Add 15 recommendations using the repository
    for (let i = 0; i < amount; i++) {
        await addDummyRecommendation(i);
    }
}

async function addClicksAndSubscribers({memberId}) {
    const recommendations = await recommendationsService.repository.getAll({order: [{field: 'createdAt', direction: 'desc'}]});

    // Create 2 clicks for 1st
    for (let i = 0; i < 2; i++) {
        const clickEvent = ClickEvent.create({
            recommendationId: recommendations[0].id
        });

        await recommendationsService.clickEventRepository.save(clickEvent);
    }

    // Create 3 clicks for 2nd
    for (let i = 0; i < 3; i++) {
        const clickEvent = ClickEvent.create({
            recommendationId: recommendations[1].id
        });

        await recommendationsService.clickEventRepository.save(clickEvent);
    }

    // Create 3 subscribers for 1st
    for (let i = 0; i < 3; i++) {
        const subscribeEvent = SubscribeEvent.create({
            recommendationId: recommendations[0].id,
            memberId
        });

        await recommendationsService.subscribeEventRepository.save(subscribeEvent);
    }

    // Create 2 subscribers for 3rd
    for (let i = 0; i < 2; i++) {
        const subscribeEvent = SubscribeEvent.create({
            recommendationId: recommendations[2].id,
            memberId
        });

        await recommendationsService.subscribeEventRepository.save(subscribeEvent);
    }
}

describe('Recommendations Admin API', function () {
    let agent, memberId;

    before(async function () {
        agent = await agentProvider.getAdminAPIAgent();
        await fixtureManager.init('posts', 'members');
        await agent.loginAsOwner();

        memberId = fixtureManager.get('members', 0).id;
    });

    afterEach(async function () {
        for (const recommendation of (await recommendationsService.repository.getAll())) {
            recommendation.delete();
            await recommendationsService.repository.save(recommendation);
        }
        mockManager.restore();
    });

    it('Can fetch recommendations with relations when there are no recommendations', async function () {
        const recommendations = await recommendationsService.repository.getCount();
        assert.equal(recommendations, 0, 'This test expects there to be no recommendations');

        const {body: page1} = await agent.get('recommendations/?include=count.clicks,count.subscribers')
            .expectStatus(200)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag
            })
            .matchBodySnapshot({});

        assert.equal(page1.recommendations.length, 0);
    });

    it('Can add a minimal recommendation', async function () {
        const {body} = await agent.post('recommendations/')
            .body({
                recommendations: [{
                    title: 'Dog Pictures',
                    url: 'https://dogpictures.com'
                }]
            })
            .expectStatus(201)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag,
                location: anyLocationFor('recommendations')
            })
            .matchBodySnapshot({
                recommendations: [
                    {
                        id: anyObjectId,
                        created_at: anyISODateTime
                    }
                ]
            });

        // Check everything is set correctly
        assert.equal(body.recommendations[0].title, 'Dog Pictures');
        assert.equal(body.recommendations[0].url, 'https://dogpictures.com/');
        assert.equal(body.recommendations[0].reason, null);
        assert.equal(body.recommendations[0].excerpt, null);
        assert.equal(body.recommendations[0].featured_image, null);
        assert.equal(body.recommendations[0].favicon, null);
        assert.equal(body.recommendations[0].one_click_subscribe, false);
    });

    it('Can add a full recommendation', async function () {
        const {body} = await agent.post('recommendations/')
            .body({
                recommendations: [{
                    title: 'Dog Pictures',
                    url: 'https://dogpictures.com',
                    reason: 'Because dogs are cute',
                    excerpt: 'Dogs are cute',
                    featured_image: 'https://dogpictures.com/dog.jpg',
                    favicon: 'https://dogpictures.com/favicon.ico',
                    one_click_subscribe: true
                }]
            })
            .expectStatus(201)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag,
                location: anyLocationFor('recommendations')
            })
            .matchBodySnapshot({
                recommendations: [
                    {
                        id: anyObjectId,
                        created_at: anyISODateTime
                    }
                ]
            });

        // Check everything is set correctly
        assert.equal(body.recommendations[0].title, 'Dog Pictures');
        assert.equal(body.recommendations[0].url, 'https://dogpictures.com/');
        assert.equal(body.recommendations[0].reason, 'Because dogs are cute');
        assert.equal(body.recommendations[0].excerpt, 'Dogs are cute');
        assert.equal(body.recommendations[0].featured_image, 'https://dogpictures.com/dog.jpg');
        assert.equal(body.recommendations[0].favicon, 'https://dogpictures.com/favicon.ico');
        assert.equal(body.recommendations[0].one_click_subscribe, true);
    });

    it('Cannot add the same recommendation twice', async function () {
        await agent.post('recommendations/')
            .body({
                recommendations: [{
                    title: 'Dog Pictures',
                    url: 'https://dogpictures.com'
                }]
            })
            .matchBodySnapshot({
                recommendations: [
                    {
                        id: anyObjectId,
                        created_at: anyISODateTime
                    }
                ]
            });

        await agent.post('recommendations/')
            .body({
                recommendations: [{
                    title: 'Dog Pictures 2',
                    url: 'https://dogpictures.com'
                }]
            })
            .expectStatus(422)
            .matchBodySnapshot({
                errors: [
                    {
                        id: anyErrorId
                    }
                ]
            });
    });

    it('Can edit recommendation', async function () {
        const id = await addDummyRecommendation();
        const {body} = await agent.put(`recommendations/${id}/`)
            .body({
                recommendations: [{
                    title: 'Cat Pictures',
                    url: 'https://dogpictures.com',
                    reason: 'Because cats are cute',
                    excerpt: 'Cats are cute',
                    featured_image: 'https://catpictures.com/cat.jpg',
                    favicon: 'https://catpictures.com/favicon.ico',
                    one_click_subscribe: false
                }]
            })
            .expectStatus(200)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag
            })
            .matchBodySnapshot({
                recommendations: [
                    {
                        id: anyObjectId,
                        created_at: anyISODateTime,
                        updated_at: anyISODateTime
                    }
                ]
            });

        // Check everything is set correctly
        assert.equal(body.recommendations[0].id, id);
        assert.equal(body.recommendations[0].title, 'Cat Pictures');
        assert.equal(body.recommendations[0].url, 'https://dogpictures.com/');
        assert.equal(body.recommendations[0].reason, 'Because cats are cute');
        assert.equal(body.recommendations[0].excerpt, 'Cats are cute');
        assert.equal(body.recommendations[0].featured_image, 'https://catpictures.com/cat.jpg');
        assert.equal(body.recommendations[0].favicon, 'https://catpictures.com/favicon.ico');
        assert.equal(body.recommendations[0].one_click_subscribe, false);
    });

    it('Can edit recommendation and set nullable fields to null', async function () {
        const id = await addDummyRecommendation();
        const {body} = await agent.put(`recommendations/${id}/`)
            .body({
                recommendations: [{
                    reason: null,
                    excerpt: null,
                    featured_image: null,
                    favicon: null
                }]
            })
            .expectStatus(200)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag
            })
            .matchBodySnapshot({
                recommendations: [
                    {
                        id: anyObjectId,
                        created_at: anyISODateTime,
                        updated_at: anyISODateTime
                    }
                ]
            });

        // Check everything is set correctly
        assert.equal(body.recommendations[0].id, id);
        assert.equal(body.recommendations[0].reason, null);
        assert.equal(body.recommendations[0].excerpt, null);
        assert.equal(body.recommendations[0].featured_image, null);
        assert.equal(body.recommendations[0].favicon, null);
    });

    it('Can edit some fields of a recommendation without changing others', async function () {
        const id = await addDummyRecommendation();
        const {body} = await agent.put(`recommendations/${id}/`)
            .body({
                recommendations: [{
                    title: 'Changed'
                }]
            })
            .expectStatus(200)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag
            })
            .matchBodySnapshot({
                recommendations: [
                    {
                        id: anyObjectId,
                        created_at: anyISODateTime,
                        updated_at: anyISODateTime
                    }
                ]
            });

        // Check everything is set correctly
        assert.equal(body.recommendations[0].id, id);
        assert.equal(body.recommendations[0].title, 'Changed');
        assert.equal(body.recommendations[0].url, 'https://recommendation0.com/');
        assert.equal(body.recommendations[0].reason, 'Reason 0');
        assert.equal(body.recommendations[0].excerpt, 'Test excerpt');
        assert.equal(body.recommendations[0].featured_image, 'https://recommendation0.com/featured.jpg');
        assert.equal(body.recommendations[0].favicon, 'https://recommendation0.com/favicon.ico');
        assert.equal(body.recommendations[0].one_click_subscribe, true);
    });

    it('Cannot use invalid protocols when editing', async function () {
        const id = await addDummyRecommendation();

        await agent.put(`recommendations/${id}/`)
            .body({
                recommendations: [{
                    title: 'Cat Pictures',
                    url: 'https://dogpictures.com',
                    reason: 'Because cats are cute',
                    excerpt: 'Cats are cute',
                    featured_image: 'ftp://dogpictures.com/dog.jpg',
                    favicon: 'ftp://dogpictures.com/favicon.ico',
                    one_click_subscribe: false
                }]
            })
            .expectStatus(422)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag
            })
            .matchBodySnapshot({
                errors: [
                    {
                        id: anyErrorId
                    }
                ]
            });
    });

    it('Can delete recommendation', async function () {
        const id = await addDummyRecommendation();
        await agent.delete(`recommendations/${id}/`)
            .expectStatus(204)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag
            })
            .matchBodySnapshot({});
    });

    it('Can browse', async function () {
        await addDummyRecommendation();

        await agent.get('recommendations/')
            .expectStatus(200)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag
            })
            .matchBodySnapshot({
                recommendations: [
                    {
                        id: anyObjectId,
                        created_at: anyISODateTime,
                        updated_at: anyISODateTime
                    }
                ]
            });
    });

    it('Can request pages', async function () {
        // Add 15 recommendations using the repository
        await addDummyRecommendations(15);

        const {body: page1} = await agent.get('recommendations/?page=1&limit=10')
            .expectStatus(200)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag
            })
            .matchBodySnapshot({
                recommendations: new Array(10).fill({
                    id: anyObjectId,
                    created_at: anyISODateTime,
                    updated_at: anyISODateTime
                })
            });

        assert.equal(page1.meta.pagination.page, 1);
        assert.equal(page1.meta.pagination.limit, 10);
        assert.equal(page1.meta.pagination.pages, 2);
        assert.equal(page1.meta.pagination.next, 2);
        assert.equal(page1.meta.pagination.prev, null);
        assert.equal(page1.meta.pagination.total, 15);

        const {body: page2} = await agent.get('recommendations/?page=2&limit=10')
            .expectStatus(200)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag
            })
            .matchBodySnapshot({
                recommendations: new Array(5).fill({
                    id: anyObjectId,
                    created_at: anyISODateTime,
                    updated_at: anyISODateTime
                })
            });

        assert.equal(page2.meta.pagination.page, 2);
        assert.equal(page2.meta.pagination.limit, 10);
        assert.equal(page2.meta.pagination.pages, 2);
        assert.equal(page2.meta.pagination.next, null);
        assert.equal(page2.meta.pagination.prev, 1);
        assert.equal(page2.meta.pagination.total, 15);
    });

    it('Uses default limit of 5', async function () {
        await addDummyRecommendations(6);
        const {body: page1} = await agent.get('recommendations/')
            .expectStatus(200)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag
            });

        assert.equal(page1.meta.pagination.limit, 5);
    });

    it('Can include click and subscribe counts', async function () {
        await addDummyRecommendations(5);
        await addClicksAndSubscribers({memberId});

        const {body: page1} = await agent.get('recommendations/?include=count.clicks,count.subscribers')
            .expectStatus(200)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag
            })
            .matchBodySnapshot({
                recommendations: new Array(5).fill({
                    id: anyObjectId,
                    created_at: anyISODateTime,
                    updated_at: anyISODateTime
                })
            });

        assert.equal(page1.recommendations[0].count.clicks, 2);
        assert.equal(page1.recommendations[1].count.clicks, 3);

        assert.equal(page1.recommendations[0].count.subscribers, 3);
        assert.equal(page1.recommendations[1].count.subscribers, 0);
        assert.equal(page1.recommendations[2].count.subscribers, 2);
    });

    it('Can include only clicks', async function () {
        await addDummyRecommendations(5);
        await addClicksAndSubscribers({memberId});

        const {body: page1} = await agent.get('recommendations/?include=count.clicks')
            .expectStatus(200)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag
            })
            .matchBodySnapshot({
                recommendations: new Array(5).fill({
                    id: anyObjectId,
                    created_at: anyISODateTime,
                    updated_at: anyISODateTime
                })
            });

        assert.equal(page1.recommendations[0].count.clicks, 2);
        assert.equal(page1.recommendations[1].count.clicks, 3);

        assert.equal(page1.recommendations[0].count.subscribers, undefined);
        assert.equal(page1.recommendations[1].count.subscribers, undefined);
        assert.equal(page1.recommendations[2].count.subscribers, undefined);
    });

    it('Can include only subscribers', async function () {
        await addDummyRecommendations(5);
        await addClicksAndSubscribers({memberId});

        const {body: page1} = await agent.get('recommendations/?include=count.subscribers')
            .expectStatus(200)
            .matchHeaderSnapshot({
                'content-version': anyContentVersion,
                etag: anyEtag
            })
            .matchBodySnapshot({
                recommendations: new Array(5).fill({
                    id: anyObjectId,
                    created_at: anyISODateTime,
                    updated_at: anyISODateTime
                })
            });

        assert.equal(page1.recommendations[0].count.clicks, undefined);
        assert.equal(page1.recommendations[1].count.clicks, undefined);

        assert.equal(page1.recommendations[0].count.subscribers, 3);
        assert.equal(page1.recommendations[1].count.subscribers, 0);
        assert.equal(page1.recommendations[2].count.subscribers, 2);
    });
});
