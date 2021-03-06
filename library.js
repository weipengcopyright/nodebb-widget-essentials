"use strict";

var async = module.parent.require('async');
var nconf = module.parent.require('nconf');
var validator = module.parent.require('validator');

var db = module.parent.require('./database');
var categories = module.parent.require('./categories');
var user = module.parent.require('./user');
var plugins = module.parent.require('./plugins');
var topics = module.parent.require('./topics');
var posts = module.parent.require('./posts');
var groups = module.parent.require('./groups');
var translator = module.parent.require('../public/src/modules/translator');

var app;

var Widget = module.exports;

Widget.init = function(params, callback) {
	app = params.app;

	callback();
};

Widget.renderHTMLWidget = function(widget, callback) {
	widget.html = widget.data ? widget.data.html : '';
	setImmediate(callback, null, widget);
};

Widget.renderTextWidget = function(widget, callback) {
	var parseAsPost = !!widget.data.parseAsPost;
	var text = widget.data.text;

	async.waterfall([
		function (next) {
			if (parseAsPost) {
				plugins.fireHook('filter:parse.raw', text, next);
			} else {
				next(null, text.replace(/\r\n/g, "<br />"));
			}
		},
		function (text, next) {
			widget.html = text;
			next(null, widget);
		}
	], callback);
};

Widget.renderRecentViewWidget = function(widget, callback) {
	async.waterfall([
		function (next) {
			topics.getLatestTopics(widget.uid, 0, 19, 'month', next);
		},
		function (data, next) {
			data.relative_path = nconf.get('relative_path');

			app.render('recent', data, next);
		},
		function (html, next) {
			html = html.replace(/<ol[\s\S]*?<br \/>/, '').replace('<br>', '');
			translator.translate(html, function(translatedHTML) {
				widget.html = translatedHTML;
				next(null, widget);
			});
		}
	], callback);
};

Widget.renderActiveUsersWidget = function(widget, callback) {
	var count = Math.max(1, widget.data.numUsers || 24);
	var cidOrtid;
	var match;

	async.waterfall([
		function (next) {
			if (widget.data.cid) {
				cidOrtid = widget.data.cid;
				categories.getActiveUsers(cidOrtid, next);
			} else if (widget.area.url.startsWith('topic')) {
				match = widget.area.url.match('topic/([0-9]+)');
				cidOrtid = (match && match.length > 1) ? match[1] : 1;
				topics.getUids(cidOrtid, next);
			} else if (widget.area.url === '') {
				posts.getRecentPosterUids(0, count - 1, next);
			} else {
				match = widget.area.url.match('[0-9]+');
				cidOrtid = match ? match[0] : 1;
				categories.getActiveUsers(cidOrtid, next);
			}
		},
		function (uids, next) {
			uids = uids.slice(0, count);

			user.getUsersFields(uids, ['uid', 'username', 'userslug', 'picture'], next);
		},
		function (userData, next) {
			app.render('widgets/activeusers', {
				active_users: userData,
				relative_path: nconf.get('relative_path')
			}, next);
		},
		function (html, next) {
			widget.html = html;
			next(null, widget);
		}
	], callback);
};

Widget.renderLatestUsersWidget = function(widget, callback) {
	var count = Math.max(1, widget.data.numUsers || 24);
	async.waterfall([
		function (next) {
			user.getUsersFromSet('users:joindate', widget.uid, 0, count - 1, next);
		},
		function (users, next) {
			app.render('widgets/latestusers', {
				users: users,
				relative_path: nconf.get('relative_path')
			}, next);
		},
		function (html, next) {
			widget.html = html;
			next(null, widget);
		}
	], callback);
};

Widget.renderModeratorsWidget = function(widget, callback) {
	var cid;

	if (widget.data.cid) {
		cid = widget.data.cid;
	} else {
		var match = widget.area.url.match('[0-9]+');
		cid = match ? match[0] : 1;
	}

	async.waterfall([
		function (next) {
			categories.getModerators(cid, next);
		},
		function (moderators, next) {
			app.render('widgets/moderators', {
				moderators: moderators,
				relative_path: nconf.get('relative_path')
			}, next);
		},
		function (html, next) {
			widget.html = html;
			next(null, widget);
		}
	], callback);
};

Widget.renderForumStatsWidget = function(widget, callback) {
	async.parallel({
		global: function(next) {
			db.getObjectFields('global', ['topicCount', 'postCount', 'userCount'], next);
		},
		onlineCount: function(next) {
			var now = Date.now();
			db.sortedSetCount('users:online', now - 300000, '+inf', next);
		},
		guestCount: function(next) {
			module.parent.require('./socket.io/admin/rooms').getTotalGuestCount(next);
		}
	}, function(err, results) {
		if (err) {
			return callback(err);
		}

		var stats = {
			topics: results.global.topicCount ? results.global.topicCount : 0,
			posts: results.global.postCount ? results.global.postCount : 0,
			users: results.global.userCount ? results.global.userCount : 0,
			online: results.onlineCount + results.guestCount,
			statsClass: widget.data.statsClass
		};
		app.render('widgets/forumstats', stats, function(err, html) {
			translator.translate(html, function(translatedHTML) {
				widget.html = translatedHTML;
				callback(err, widget);
			});
		});
	});
};

Widget.renderRecentPostsWidget = function(widget, callback) {
	function done(err, posts) {
		if (err) {
			return callback(err);
		}
		var data = {
			posts: posts,
			numPosts: numPosts,
			cid: cid,
			relative_path: nconf.get('relative_path')
		};
		app.render('widgets/recentposts', data, function(err, html) {
			translator.translate(html, function(translatedHTML) {
				widget.html = translatedHTML;
				callback(err, widget);
			});
		});
	}
	var cid = widget.data.cid;
	if (!parseInt(cid, 10)) {
		var match = widget.area.url.match('category/([0-9]+)');
		cid = (match && match.length > 1) ? match[1] : null;
	}
	var numPosts = widget.data.numPosts || 4;
	if (cid) {
		categories.getRecentReplies(cid, widget.uid, numPosts, done);
	} else {
		posts.getRecentPosts(widget.uid, 0, Math.max(0, numPosts - 1), 'alltime', done);
	}
};

Widget.renderRecentTopicsWidget = function(widget, callback) {
	var numTopics = (widget.data.numTopics || 8) - 1;

	topics.getTopicsFromSet('topics:recent', widget.uid, 0, Math.max(0, numTopics), function(err, data) {
		if (err) {
			return callback(err);
		}

		app.render('widgets/recenttopics', {
			topics: data.topics,
			numTopics: numTopics,
			relative_path: nconf.get('relative_path')
		}, function(err, html) {
			translator.translate(html, function(translatedHTML) {
				widget.html = translatedHTML;
				callback(err, widget);
			});
		});
	});
};

Widget.renderCategories = function(widget, callback) {
	categories.getCategoriesByPrivilege('cid:0:children', widget.uid, 'find', function(err, data) {
		app.render('widgets/categories', {
			categories: data,
			relative_path: nconf.get('relative_path')
		}, function (err, html) {
			widget.html = html;
			callback(err, widget);
		});
	});
};

Widget.renderPopularTags = function(widget, callback) {
	var numTags = widget.data.numTags || 8;
	topics.getTags(0, numTags - 1, function(err, tags) {
		if (err) {
			return callback(err);
		}

		app.render('widgets/populartags', {
			tags: tags,
			relative_path: nconf.get('relative_path')
		}, function (err, html) {
			widget.html = html;
			callback(err, widget);
		});
	});
};

Widget.renderPopularTopics = function(widget, callback) {
	var numTopics = widget.data.numTopics || 8;
	topics.getPopular(widget.data.duration || 'alltime', widget.uid, numTopics, function(err, topics) {
		if (err) {
			return callback(err);
		}

		app.render('widgets/populartopics', {
			topics: topics,
			numTopics: numTopics,
			relative_path: nconf.get('relative_path')
		}, function(err, html) {
			translator.translate(html, function(translatedHTML) {
				widget.html = translatedHTML;
				callback(err, widget);
			});
		});
	});
};

Widget.renderMyGroups = function(widget, callback) {
	var uid = widget.uid;
	var numGroups = parseInt(widget.data.numGroups, 10) || 9;
	groups.getUserGroups([uid], function(err, groupsData) {
		if (err) {
			return callback(err);
		}
		var userGroupData = groupsData.length ? groupsData[0] : [];
		userGroupData = userGroupData.slice(0, numGroups);
		app.render('widgets/groups', {
			groups: userGroupData,
			relative_path: nconf.get('relative_path')
		}, function(err, html) {
			translator.translate(html, function(translatedHTML) {
				widget.html = translatedHTML;
				callback(err, widget);
			});
		});
	});
};

Widget.renderGroupPosts = function(widget, callback) {
	var numPosts = parseInt(widget.data.numPosts, 10) || 4;
	async.waterfall([
		function (next) {
			groups.getLatestMemberPosts(widget.data.groupName, numPosts, widget.uid, next);
		},
		function (posts, next) {
			app.render('widgets/groupposts', {posts: posts}, next);
		},
		function(html, next) {
			translator.translate(html, function(translatedHTML) {
				widget.html = translatedHTML;
				next(null, widget);
			});
		}
	], callback);
};

Widget.renderNewGroups = function(widget, callback) {
	var numGroups = parseInt(widget.data.numGroups, 10) || 8;
	async.waterfall([
		function(next) {
			db.getSortedSetRevRange('groups:visible:createtime', 0, numGroups - 1, next);
		},
		function(groupNames, next) {
			groups.getGroupsData(groupNames, next);
		},
		function(groupsData, next) {
			groupsData = groupsData.filter(Boolean);

			app.render('widgets/groups', {groups: groupsData, relative_path: nconf.get('relative_path')}, next);
		},
		function (html, next) {
			translator.translate(html, function(translatedHTML) {
				widget.html = translatedHTML;
				next(null, widget);
			});
		}
	], callback);
};

Widget.renderSuggestedTopics = function(widget, callback) {

	var numTopics = Math.max(0, (widget.data.numTopics || 8) - 1);
	var tidMatch = widget.area.url.match('topic/([0-9]+)');
	var cidMatch = widget.area.url.match('category/([0-9]+)');

	async.waterfall([
		function (next) {
			if (tidMatch) {
				var tid = tidMatch.length > 1 ? tidMatch[1] : 1;
				topics.getSuggestedTopics(tid, widget.uid, 0, numTopics, next);
			} else if (cidMatch) {
				var cid = cidMatch.length > 1 ? cidMatch[1] : 1;
				categories.getCategoryTopics({
					cid: cid,
					uid: widget.uid,
					set: 'cid:' + cid + ':tids',
					reverse: false,
					start: 0,
					stop: numTopics
				}, function(err, data) {
					next(err, data ? data.topics : []);
				});
			} else {
				topics.getTopicsFromSet('topics:recent', widget.uid, 0, numTopics, function(err, data) {
					next(err, data ? data.topics : []);
				});
			}
		},
		function (topics, next) {
			topics = topics.filter(function(topic) {
				return topic && !topic.deleted;
			});
			app.render('widgets/suggestedtopics', {
				topics: topics,
				relative_path: nconf.get('relative_path')
			}, function (err, html) {
				widget.html = html;
				next(err, widget);
			});
		}
	], callback);
};

Widget.defineWidgets = function(widgets, callback) {
	async.waterfall([
		function(next) {
			async.map([
				{
					widget: "html",
					name: "HTML",
					description: "Any text, html, or embedded script.",
					content: 'admin/html'
				},
				{
					widget: "text",
					name: "Text",
					description: "Text, optionally parsed as a post.",
					content: 'admin/text'
				},
				{
					widget: "recentreplies",
					name: "Recent Replies[deprecated]",
					description: "List of recent replies in a category.",
					content: 'admin/categorywidget'
				},
				{
					widget: "activeusers",
					name: "Active Users",
					description: "List of active users in a category.",
					content: 'admin/activeusers'
				},
				{
					widget: "latestusers",
					name: "Latest Users",
					description: "List of latest registered users.",
					content: 'admin/latestusers'
				},
				{
					widget: "moderators",
					name: "Moderators",
					description: "List of moderators in a category.",
					content: 'admin/categorywidget'
				},
				{
					widget: "forumstats",
					name: "Forum Stats",
					description: "Lists user, topics, and post count.",
					content: 'admin/forumstats'
				},
				{
					widget: "recentposts",
					name: "Recent Posts",
					description: "Lists the latest posts on your forum.",
					content: 'admin/recentposts'
				},
				{
					widget: "recenttopics",
					name: "Recent Topics",
					description: "Lists the latest topics on your forum.",
					content: 'admin/recenttopics'
				},
				{
					widget: "recentview",
					name: "Recent View",
					description: "Renders the /recent page",
					content: 'admin/defaultwidget'
				},
				{
					widget: "categories",
					name: "Categories",
					description: "Lists the categories on your forum",
					content: 'admin/categorieswidget'
				},
				{
					widget: "populartags",
					name: "Popular Tags",
					description: "Lists popular tags on your forum",
					content: 'admin/populartags'
				},
				{
					widget: "populartopics",
					name: "Popular Topics",
					description: "Lists popular topics on your forum",
					content: 'admin/populartopics'
				},
				{
					widget: "mygroups",
					name: "My Groups",
					description: "List of groups that you are in",
					content: 'admin/mygroups'
				},
				{
					widget: "newgroups",
					name: "New Groups",
					description: "List of newest groups",
					content: 'admin/mygroups'
				},
				{
					widget: "suggestedtopics",
					name: "Suggested Topics",
					description: "Lists of suggested topics.",
					content: 'admin/recenttopics'
				}
			], function(widget, next) {
				app.render(widget.content, {}, function(err, html) {
					widget.content = html;
					next(err, widget);
				});
			}, function(err, _widgets) {
				widgets = widgets.concat(_widgets);
				next(err);
			});
		},
		function(next) {
			db.getSortedSetRevRange('groups:visible:createtime', 0, - 1, next);
		},
		function(groupNames, next) {
			groups.getGroupsData(groupNames, next);
		},
		function(groupsData, next) {
			groupsData = groupsData.filter(Boolean);
			groupsData.forEach(function(group) {
				group.name = validator.escape(String(group.name));
			});
			app.render('admin/groupposts', {groups: groupsData}, function(err, html) {
				widgets.push({
					widget: "groupposts",
					name: "Group Posts",
					description: "Posts made my members of a group",
					content: html
				});
				next(err, widgets);
			});
		}
	], callback);
};
