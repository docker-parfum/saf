import {Command, flags} from '@oclif/command'
import {ContextualizedEvaluation, ContextualizedProfile, convertFileContextual, ExecJSON} from 'inspecjs'
import fs from 'fs'
import YAML from 'yaml'
import {calculateCompliance, extractStatusCounts, renameStatusName, severityTargetsObject} from '../../utils/threshold'
import _ from 'lodash'
import flat from 'flat'
import {convertFullPathToFilename} from '../../utils/global'

export default class Summary extends Command {
  static aliases = ['summary']

  static usage = 'view -i, --input=FILE -j, --json'

  static description = 'Get a quick compliance overview of an HDF file '

  static flags = {
    help: flags.help({char: 'h'}),
    input: flags.string({char: 'i', required: true, multiple: true, description: 'Input HDF files'}),
    json: flags.boolean({char: 'j', required: false, description: 'Output results as JSON'}),
    output: flags.string({char: 'o', required: false}),
  }

  static examples = ['saf view:summary -i rhel7-results.json']

  async run() {
    const {flags} = this.parse(Summary)
    const summaries: Record<string, Record<string, Record<string, number>>[]> = {}
    const complianceScores: Record<string, number[]> = {}

    const execJSONs: Record<string, ContextualizedEvaluation> = {}
    flags.input.forEach(file => {
      execJSONs[file] = convertFileContextual(fs.readFileSync(file, 'utf8')) as ContextualizedEvaluation
    })
    Object.entries(execJSONs).forEach(([fileName, parsedExecJSON]) => {
      const summary: Record<string, Record<string, number>> = {}
      const parsedProfile = parsedExecJSON.contains[0] as ContextualizedProfile
      const profileName = parsedProfile.data.name
      const overallStatusCounts = extractStatusCounts(parsedProfile)
      const overallCompliance = calculateCompliance(overallStatusCounts)

      const existingCompliance = _.get(complianceScores, profileName) || []
      existingCompliance.push(overallCompliance)
      _.set(complianceScores, `["${profileName.replace(/"/g, '\\"')}"]`, existingCompliance)

      // Severity counts
      for (const [severity, severityTargets] of Object.entries(severityTargetsObject)) {
        const severityStatusCounts = extractStatusCounts(parsedProfile, severity)
        for (const severityTarget of severityTargets) {
          const [statusName, _severity, thresholdType] = severityTarget.split('.')
          _.set(summary, severityTarget.replace(`.${thresholdType}`, ''), _.get(severityStatusCounts, renameStatusName(statusName)))
        }
      }
      // Total Counts
      for (const [type, counts] of Object.entries(summary)) {
        let total = 0
        for (const [_severity, count] of Object.entries(counts)) {
          total += count
        }
        _.set(summary, `${type}.total`, total)
      }
      summaries[profileName] = (_.get(summaries, profileName) || [])
      summaries[profileName].push(summary)
    })

    const totals = {}
    Object.entries(summaries).forEach(([profileName, profileSummaries]) => {
      profileSummaries.forEach(profileSummary => {
        const flattened: Record<string, number> = flat.flatten(profileSummary)
        Object.entries(flattened).forEach(([key, value]) => {
          const existingValue = _.get(totals, `${profileName}.${key}`)
          if (existingValue) {
            _.set(totals, `["${profileName.replace(/"/g, '\\"')}"].${key}`, existingValue + value)
          } else {
            _.set(totals, `["${profileName.replace(/"/g, '\\"')}"].${key}`, value)
          }
        })
      })
    })
    const printableSummaries: Record<string, unknown>[] = []
    Object.entries(totals).forEach(([profileName, profileValues]: any) => {
      printableSummaries.push({
        profileName: profileName,
        // Extract filename from execJSONs
        resultSets: Object.entries(execJSONs).filter(([fileName, execJSON]) => {
          return execJSON.data.profiles[0].name === profileName
        }).map(([filePath, execJSON]) => {
          return convertFullPathToFilename(filePath)
        }),
        compliance: _.mean(complianceScores[profileName]),
        ...profileValues,
      })
    })
    console.log(flags.json ? JSON.stringify(printableSummaries) : YAML.stringify(printableSummaries))
    if (flags.output) {
      fs.writeFileSync(flags.output, flags.json ? JSON.stringify(printableSummaries) : YAML.stringify(printableSummaries))
    }
  }
}
