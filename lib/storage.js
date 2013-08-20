// this file is adapted from mikeal/level-sleep/index.js

var util = require('util')
var events = require('events')
var mutex = require('level-mutex')

function noop() {}

module.exports = Database

function Database (db, cb) {
  if (!(this instanceof Database)) return new Database(db, cb)
  var self = this
  this.db = db
  this.mutex = mutex(this.db)
  this.seqKey = 's'
  this.dataKey = 'd'
  this.sep = '\xff'
  this.getSeq(function(err, seq) {
    if (err) {
      self.seq = 0
      return cb(false, 0)
    }
    self.seq = seq
    cb(false, seq)
  })
}

util.inherits(Database, events.EventEmitter)

Database.prototype._key = function(sublevel, key) {
  return this.sep + sublevel + this.sep + key
}

Database.prototype.getSeq = function(cb) {
  var opts = { 
    start: this._key(this.seqKey, ''),
    end: this._key(this.seqKey, this.sep)
  }
  this.mutex.peekLast(opts, function (e, key, val) {
    if (e) return cb(e)
    return cb(false, val._seq)
  })
}

Database.prototype.put = function (key, value, cb) {
  var self = this
  this.seq += 1
  var seq = this.seq
  if (typeof seq !== 'number') throw new Error('Invalid sequence.')
  value._seq = seq
  this.mutex.put(this._key(this.seqKey, seq), {_id: key, _seq: seq}, noop)
  this.mutex.put(this._key(this.dataKey, key), value, function (e) {
    if (e) return cb(e)
    cb(null, seq)
    self.emit('entry', {seq: seq, id: key, data: value})
  })
}

Database.prototype.del = function (key, cb) {
  this.seq += 1
  var seq = this.seq
  this.mutex.put(this._key(this.seqKey, seq), {_deleted: true, _id: key, _seq: seq}, noop)
  this.mutex.put(this._key(this.dataKey, key), {_deleted: true, _seq: seq}, function (e) {
    if (e) return cb(e)
    cb(null, seq)
    self.emit('entry', {seq: seq, id: key, data: value, deleted: true})
  })
}

Database.prototype.get = function (key, cb) {
  var dkey = this._key(this.dataKey, key)
  var opts = {
    start: dkey,
    end: dkey + this.sep
  }
  this.mutex.peekLast(opts, function (e, key, value) {
    if (e) return cb(new Error('not found.'))
    cb(null, value)
  })
}

Database.prototype.getSequences = function (opts) {
  opts.since = opts.since || 0
  opts.limit = opts.limit || -1
  var pending = []
  var self = this
  var onEntry = pending.push.bind(pending)
  var ee = new events.EventEmitter()
  var since = opts.since || 0
  var startKey = this._key(this.seqKey, since)
  var endKey = this._key(this.seqKey, this.sep)
  var rangeOpts = { 
    start: startKey,
    end: endKey,
    limit: opts.limit
  }

  this.on('entry', onEntry)
  var sequences = this.db.createReadStream(rangeOpts)

  sequences.on('data', function (change) {
    var key = change.value._id
    var seq = change.value._seq
    var entry = { 
      id: key,
      seq: seq,
      deleted: change.value._deleted
    }
    if (opts.include_data) {
      // even if it was deleted we do a get to ensure correct ordering by relying on the mutex
      self.mutex.get(self._key(self.dataKey, key), function (e, value) {
        if (!entry.deleted) entry.data = value
        ee.emit('entry', entry)
      })
    } else {
      ee.emit('entry', entry)
    }
  })
  sequences.on('end', function () {
    // hack: get something from the mutex to ensure we're after any data gets
    self.mutex.get('foo', function () {
      pending.forEach(function (entry) {
        if (!opts.include_data) {
          entry = _.clone(entry)
          delete entry.data
        }
        if (opts.since < entry.seq) ee.emit('entry')
      })
      self.removeListener('entry', onEntry)

      if (opts.continuous) {
        // TODO: continuous once it is defined.
      } else {
        ee.emit('end')
      }
    })
  })
  return ee
}

// Database.prototype.pull = function (url, opts, cb) {
//   var self = this
//   if (!cb && typeof opts === 'function') {
//     cb = opts
//     opts = {}
//   }
//   if (typeof opts.continuous === 'undefined') opts.continuous = false
//   if (typeof opts.since === 'undefined') opts.since = null
//   if (typeof opts.save === 'undefined') opts.save = true
// 
//   function _run () {
//     var s = sleep.client(url, opts)
//     s.on('entry', function (entry) {
//       self.put(entry.id, entry.data, function (e) {
//         if (e) return cb(e) // probably need something smarter here
//       })
//     })
//     s.on('end', function () {
//       cb(null)
//     })
//   }
// 
//   if (opts.save && opts.since === null) {
//     self.mutex.get(encode([self.name, 2, url]), function (e, since) {
//       if (e) since = 0
//       opts.since = since
//       _run()
//     })
//   } else {
//     _run()
//   }
// }


// Database.prototype.compact = function (cb) {
//   var self = this
//   var rangeOpts =
//     { start: bytewise.encode([this.name, 1, {}])
//     , end: bytewise.encode([this.name, 1, null])
//     , reverse: true
//     }
// 
//   var sequences = self.mutex.lev.createReadStream(rangeOpts)
//     , id = null
//     , seqs = []
//     , deletes = []
//     ;
//   sequences.on('data', function (row) {
//     var key = bytewise.decode(row.key)
//       , _id = key[2]
//       , seq = key[3]
//       , deleted = key[4]
//       ;
//     if (id !== _id) {
//       id = _id
//     } else {
//       deletes.push(bytewise.encode([self.name, 0, seq, deleted]))
//       deletes.push(row.key)
//     }
//   })
//   sequences.on('end', function () {
//     deletes.forEach(function (entry) {
//       self.mutex.del(entry, noop)
//     })
//     if (deletes.length === 0) return cb(null)
//     else self.mutex.afterWrite(cb)
//   })
// }