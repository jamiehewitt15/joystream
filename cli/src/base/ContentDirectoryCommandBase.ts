import ExitCodes from '../ExitCodes'
import AccountsCommandBase from './AccountsCommandBase'
import { WorkingGroups, NamedKeyringPair } from '../Types'
import { ReferenceProperty } from 'cd-schemas/types/extrinsics/AddClassSchema'
import { BOOL_PROMPT_OPTIONS } from '../helpers/prompting'
import { Class, ClassId, CuratorGroup, CuratorGroupId, Entity } from '@joystream/types/content-directory'
import { Worker } from '@joystream/types/working-group'
import { CLIError } from '@oclif/errors'
import { Codec } from '@polkadot/types/types'

/**
 * Abstract base class for commands related to working groups
 */
export default abstract class ContentDirectoryCommandBase extends AccountsCommandBase {
  // Use when lead access is required in given command
  async requireLead(): Promise<void> {
    const selectedAccount: NamedKeyringPair = await this.getRequiredSelectedAccount()
    const lead = await this.getApi().groupLead(WorkingGroups.Curators)

    if (!lead || lead.roleAccount.toString() !== selectedAccount.address) {
      this.error('Content Working Group Lead access required for this command!', { exit: ExitCodes.AccessDenied })
    }
  }

  async promptForClass(message = 'Select a class'): Promise<Class> {
    const classes = await this.getApi().availableClasses()
    const choices = classes.map(([, c]) => ({ name: c.name.toString(), value: c }))
    if (!choices.length) {
      this.warn('No classes exist to choose from!')
      this.exit(ExitCodes.InvalidInput)
    }

    const selectedClass = await this.simplePrompt({ message, type: 'list', choices })

    return selectedClass
  }

  async classEntryByNameOrId(classNameOrId: string): Promise<[ClassId, Class]> {
    const classes = await this.getApi().availableClasses()
    const foundClass = classes.find(([id, c]) => id.toString() === classNameOrId || c.name.toString() === classNameOrId)
    if (!foundClass) {
      this.error(`Class id not found by class name or id: "${classNameOrId}"!`)
    }

    return foundClass
  }

  private async curatorGroupChoices(ids?: CuratorGroupId[]) {
    const groups = await this.getApi().availableCuratorGroups()
    return groups
      .filter(([id]) => (ids ? ids.some((allowedId) => allowedId.eq(id)) : true))
      .map(([id, group]) => ({
        name:
          `Group ${id.toString()} (` +
          `${group.active.valueOf() ? 'Active' : 'Inactive'}, ` +
          `${group.curators.toArray().length} member(s), ` +
          `${group.number_of_classes_maintained.toNumber()} classes maintained)`,
        value: id.toNumber(),
      }))
  }

  async promptForCuratorGroup(message = 'Select a Curator Group', ids?: CuratorGroupId[]): Promise<number> {
    const choices = await this.curatorGroupChoices(ids)
    if (!choices.length) {
      this.warn('No Curator Groups to choose from!')
      this.exit(ExitCodes.InvalidInput)
    }
    const selectedId = await this.simplePrompt({ message, type: 'list', choices })

    return selectedId
  }

  async promptForCuratorGroups(message = 'Select Curator Groups'): Promise<number[]> {
    const choices = await this.curatorGroupChoices()
    const selectedIds = await this.simplePrompt({ message, type: 'checkbox', choices })

    return selectedIds
  }

  async promptForClassReference(): Promise<ReferenceProperty['Reference']> {
    const selectedClass = await this.promptForClass()
    const sameOwner = await this.simplePrompt({ message: 'Same owner required?', ...BOOL_PROMPT_OPTIONS })
    return { className: selectedClass.name.toString(), sameOwner }
  }

  async promptForCurator(message = 'Choose a Curator'): Promise<number> {
    const curators = await this.getApi().groupMembers(WorkingGroups.Curators)
    const selectedCuratorId = await this.simplePrompt({
      message,
      type: 'list',
      choices: curators.map((c) => ({
        name: `${c.profile.handle.toString()} (Worker ID: ${c.workerId})`,
        value: c.workerId,
      })),
    })

    return selectedCuratorId
  }

  async getCurator(id: string | number): Promise<Worker> {
    if (typeof id === 'string') {
      id = parseInt(id)
    }

    let curator
    try {
      curator = await this.getApi().workerByWorkerId(WorkingGroups.Curators, id)
    } catch (e) {
      if (e instanceof CLIError) {
        throw new CLIError('Invalid Curator id!')
      }
      throw e
    }

    return curator
  }

  async getCuratorGroup(id: string | number): Promise<CuratorGroup> {
    if (typeof id === 'string') {
      id = parseInt(id)
    }

    const group = await this.getApi().curatorGroupById(id)

    if (!group) {
      this.error('Invalid Curator Group id!', { exit: ExitCodes.InvalidInput })
    }

    return group
  }

  async getEntity(id: string | number): Promise<Entity> {
    if (typeof id === 'string') {
      id = parseInt(id)
    }

    const entity = await this.getApi().entityById(id)

    if (!entity) {
      this.error('Invalid entity id!', { exit: ExitCodes.InvalidInput })
    }

    return entity
  }

  parseEntityPropertyValues(
    entity: Entity,
    entityClass: Class,
    includedProperties?: string[]
  ): Record<string, { value: Codec; type: string }> {
    const { properties } = entityClass
    return Array.from(entity.getField('values').entries()).reduce((columns, [propId, propValue]) => {
      const prop = properties[propId.toNumber()]
      const propName = prop.name.toString()
      const included = !includedProperties || includedProperties.some((p) => p.toLowerCase() === propName.toLowerCase())

      if (included) {
        columns[propName] = {
          value: propValue.getValue(),
          type: `${prop.property_type.type}<${prop.property_type.subtype}>`,
        }
      }
      return columns
    }, {} as Record<string, { value: Codec; type: string }>)
  }
}