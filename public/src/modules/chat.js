"use strict";
/* globals app, config, define, socket, translator, templates, utils */

define(['taskbar', 'string', 'sounds'], function(taskbar, S, sounds) {

	var module = {};

	module.prepareDOM = function() {
		// Chats Dropdown
		var	chatsToggleEl = $('#chat_dropdown'),
			chatsListEl = $('#chat-list');

		chatsToggleEl.on('click', function() {
			if (chatsToggleEl.parent().hasClass('open')) {
				return;
			}

			socket.emit('modules.chats.list', function(err, chats) {
				if (err) {
					return app.alertError(err.message);
				}

				var	userObj;

				chatsListEl.empty();

				if (!chats.length) {
					translator.get('modules:chat.no_active', function(str) {
						$('<li />')
							.addClass('no_active')
							.html('<a href="#">' + str + '</a>')
							.appendTo(chatsListEl);
					});
					return;
				}

				for(var x = 0; x<chats.length; ++x) {
					userObj = chats[x];
					$('<li />')
						.attr('data-uid', userObj.uid)
						.html('<a href="javascript:app.openChat(\'' +
							userObj.username +
							'\', ' + userObj.uid +
							');">'+
							'<i class="fa fa-circle status ' + userObj.status + '"></i> ' +
							'<img src="' +	userObj.picture + '" title="' +	userObj.username +'" />' +
							userObj.username + '</a>')
						.appendTo(chatsListEl);
				}
			});
		});

		socket.on('event:chats.receive', function(data) {
			if (module.modalExists(data.uid)) {
				var modal = module.getModal(data.uid);
				module.appendChatMessage(modal, data.message, data.timestamp);

				if (modal.is(":visible")) {
					module.bringModalToTop(modal);
					checkOnlineStatus(modal);
					taskbar.updateActive(modal.attr('UUID'));
					scrollToBottom(modal.find('#chat-content'));
				} else {
					module.toggleNew(modal.attr('UUID'), true);
				}

				if (!modal.is(":visible") || !app.isFocused) {
					app.alternatingTitle(data.username + ' has messaged you');
				}
			} else {
				module.createModal(data.username, data.uid, function(modal) {
					module.toggleNew(modal.attr('UUID'), true);
					app.alternatingTitle(data.username + ' has messaged you');
				});
			}

			if (parseInt(app.uid, 10) !== parseInt(data.fromUid, 10)) {
				sounds.play('chat-incoming');
			}
		});
	};

	module.bringModalToTop = function(chatModal) {
		var topZ = 0;
		$('.chat-modal').each(function() {
			var thisZ = parseInt($(this).css('zIndex'), 10);
			if (thisZ > topZ) {
				topZ = thisZ;
			}
		});
		chatModal.css('zIndex', topZ + 1);
	};

	module.getModal = function(touid) {
		return $('#chat-modal-' + touid);
	};

	module.modalExists = function(touid) {
		return $('#chat-modal-' + touid).length !== 0;
	};

	function checkStatus(chatModal) {
		socket.emit('user.isOnline', chatModal.touid, function(err, data) {
			translator.translate('[[global:' + data.status + ']]', function(translated) {
				$('#chat-user-status').attr('class', 'fa fa-circle status ' + data.status)
					.attr('title', translated)
					.attr('data-original-title', translated);
			});
		});
	}

	function checkOnlineStatus(chatModal) {
		if(chatModal.intervalId === 0) {
			chatModal.intervalId = setInterval(function() {
				checkStatus(chatModal);
			}, 1000);
		}
	}

	module.createModal = function(username, touid, callback) {

		templates.preload_template('chat', function() {
			translator.translate(templates.chat.parse({}), function (chatTpl) {

				var chatModal = $(chatTpl),
					uuid = utils.generateUUID();

				chatModal.intervalId = 0;
				chatModal.touid = touid;
				chatModal.username = username;

				chatModal.attr('id', 'chat-modal-' + touid);
				chatModal.attr('UUID', uuid);
				chatModal.css("position", "fixed");
				chatModal.appendTo($('body'));
				chatModal.draggable({
					start:function() {
						module.bringModalToTop(chatModal);
					},
					stop:function() {
						chatModal.find('#chat-message-input').focus();
					},
					distance: 10,
					handle: '.modal-header'
				});

				chatModal.find('#chat-with-name').html(username);

				chatModal.find('#chat-close-btn').on('click', function(e) {
					clearInterval(chatModal.intervalId);
					chatModal.intervalId = 0;
					chatModal.remove();
					chatModal.data('modal', null);
					taskbar.discard('chat', uuid);
				});

				chatModal.on('click', function(e) {
					module.bringModalToTop(chatModal);
				});

				addSendHandler(chatModal);

				getChatMessages(chatModal, function() {
					checkOnlineStatus(chatModal);
				});

				taskbar.push('chat', chatModal.attr('UUID'), {
					title:'<i class="fa fa-comment"></i> ' + username,
					state: ''
				});

				callback(chatModal);
			});
		});
	};

	module.center = function(chatModal) {
		chatModal.css("left", Math.max(0, (($(window).width() - $(chatModal).outerWidth()) / 2) + $(window).scrollLeft()) + "px");
		chatModal.css("top", "0px");
		chatModal.css("zIndex", 2000);
		chatModal.find('#chat-message-input').focus();
		return chatModal;
	};

	module.load = function(uuid) {
		var chatModal = $('div[UUID="'+uuid+'"]');
		chatModal.removeClass('hide');
		checkOnlineStatus(chatModal);
		taskbar.updateActive(uuid);
		scrollToBottom(chatModal.find('#chat-content'));
		module.center(chatModal);
		module.bringModalToTop(chatModal);
	};

	module.minimize = function(uuid) {
		var chatModal = $('div[UUID="'+uuid+'"]');
		chatModal.addClass('hide');
		taskbar.minimize('chat', uuid);
		clearInterval(chatModal.intervalId);
		chatModal.intervalId = 0;
	};

	function getChatMessages(chatModal, callback) {
		socket.emit('modules.chats.get', {touid:chatModal.touid}, function(err, messages) {
			for(var i = 0; i<messages.length; ++i) {
				module.appendChatMessage(chatModal, messages[i].content, messages[i].timestamp);
			}
			callback();
		});
	}

	function addSendHandler(chatModal) {
		chatModal.find('#chat-message-input').off('keypress').on('keypress', function(e) {
			if(e.which === 13) {
				sendMessage(chatModal);
			}
		});

		chatModal.find('#chat-message-send-btn').off('click').on('click', function(e){
			sendMessage(chatModal);
			return false;
		});
	}

	function sendMessage(chatModal) {
		var msg = S(chatModal.find('#chat-message-input').val()).stripTags().s;
		if(msg.length) {
			msg = msg +'\n';
			socket.emit('modules.chats.send', { touid:chatModal.touid, message:msg});
			chatModal.find('#chat-message-input').val('');
			sounds.play('chat-outgoing');
		}
	}

	module.appendChatMessage = function(chatModal, message, timestamp) {
		var chatContent = chatModal.find('#chat-content');

		var time = '<span class="chat-timestamp pull-right timeago" title="' + utils.toISOString(timestamp) + '"></span> ';
		message = $('<li class="chat-message">' + S(message + time).stripTags('p').s + '</li>');

		message.toggleClass('chat-message-them', !message.find('.chat-user-you').length);
		message.find('img:not(".chat-user-image")').addClass('img-responsive');
		message.find('span.timeago').timeago();

		chatContent.append(message);

		scrollToBottom(chatContent);
	};

	function scrollToBottom(chatContent) {
		if(chatContent[0]) {
			chatContent.scrollTop(
				chatContent[0].scrollHeight - chatContent.height()
			);
		}
	}

	module.toggleNew = function(uuid, state) {
		taskbar.toggleNew(uuid, state);
	};

	return module;
});